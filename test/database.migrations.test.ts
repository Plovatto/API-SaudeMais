import { readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from '@/database/migrate.js';
import { createTestDb } from './support/create-test-db.js';

describe('database migrations', () => {
  it('enables the citext and btree_gist extensions', async () => {
    const db = await createTestDb();

    const result = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('citext', 'btree_gist') order by extname`,
    );

    expect(result.rows.map((row) => row.extname)).toEqual(['btree_gist', 'citext']);
  });

  it('records each applied migration once', async () => {
    const db = await createTestDb();

    const result = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from drizzle.__drizzle_migrations`,
    );

    const migrationFiles = readdirSync(migrationsFolder).filter((name) => name.endsWith('.sql'));
    expect(result.rows[0]?.total).toBe(migrationFiles.length);
  });

  it('compares citext values without case sensitivity', async () => {
    const db = await createTestDb();

    const result = await db.execute<{ same: boolean }>(sql`select 'Ana@Example.com'::citext = 'ana@example.com' as same`);

    expect(result.rows[0]?.same).toBe(true);
  });

  it('supports exclusion constraints that mix equality and range overlap', async () => {
    const db = await createTestDb();
    await db.execute(sql`
      create table booking_probe (
        doctor_id int not null,
        slot tstzrange not null,
        exclude using gist (doctor_id with =, slot with &&)
      )
    `);
    await db.execute(sql`insert into booking_probe values (1, tstzrange('2026-01-01 10:00Z', '2026-01-01 10:30Z'))`);
    await db.execute(sql`insert into booking_probe values (2, tstzrange('2026-01-01 10:00Z', '2026-01-01 10:30Z'))`);

    await expect(
      db.execute(sql`insert into booking_probe values (1, tstzrange('2026-01-01 10:15Z', '2026-01-01 10:45Z'))`),
    ).rejects.toThrow();
  });
});
