import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '@/database/migrate.js';
import { createCleanPool } from './support/pg-test-pool.js';

const migrationFiles = readdirSync(migrationsFolder).filter((name) => name.endsWith('.sql'));

describe('runMigrations on PostgreSQL', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await createCleanPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies each migration once when several instances start together', async () => {
    await Promise.all([runMigrations(pool), runMigrations(pool), runMigrations(pool)]);

    const applied = await pool.query<{ total: number }>('select count(*)::int as total from drizzle.__drizzle_migrations');
    expect(applied.rows[0]?.total).toBe(migrationFiles.length);
  });

  it('is a no-op when everything is already applied', async () => {
    await runMigrations(pool);

    const applied = await pool.query<{ total: number }>('select count(*)::int as total from drizzle.__drizzle_migrations');
    expect(applied.rows[0]?.total).toBe(migrationFiles.length);
  });

  it('enables the citext and btree_gist extensions', async () => {
    const result = await pool.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('citext', 'btree_gist') order by extname",
    );

    expect(result.rows.map((row) => row.extname)).toEqual(['btree_gist', 'citext']);
  });

  it('releases the advisory lock and restores the statement timeout', async () => {
    const locks = await pool.query<{ total: number }>("select count(*)::int as total from pg_locks where locktype = 'advisory'");
    const timeout = await pool.query<{ statement_timeout: string }>('show statement_timeout');

    expect(locks.rows[0]?.total).toBe(0);
    expect(timeout.rows[0]?.statement_timeout).toBe('15s');
  });

  it('frees the lock and reports the migration error when a migration fails', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'broken-migrations-'));
    mkdirSync(join(folder, 'meta'));
    writeFileSync(join(folder, '9999_broken.sql'), 'SELECT * FROM table_that_does_not_exist;');
    writeFileSync(
      join(folder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, version: '7', when: Date.now() + 86_400_000, tag: '9999_broken', breakpoints: true }],
      }),
    );

    await expect(runMigrations(pool, folder)).rejects.toThrow(/table_that_does_not_exist/);

    const locks = await pool.query<{ total: number }>("select count(*)::int as total from pg_locks where locktype = 'advisory'");
    expect(locks.rows[0]?.total).toBe(0);
    await expect(runMigrations(pool)).resolves.toBeUndefined();
  });
});
