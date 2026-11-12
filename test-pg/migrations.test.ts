import { readdirSync } from 'node:fs';
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
});
