import type pg from 'pg';
import { env } from '@/config/env.js';
import { createPool } from '@/database/pg-client.js';

export function assertDisposableDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('Refusing to wipe a database whose name does not end with _test');
  }
}

export async function createCleanPool(): Promise<pg.Pool> {
  assertDisposableDatabase(env.DATABASE_URL);
  const pool = createPool(env.DATABASE_URL);
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  return pool;
}
