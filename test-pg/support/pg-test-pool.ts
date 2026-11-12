import type pg from 'pg';
import { env } from '@/config/env.js';
import { createPool } from '@/database/pg-client.js';

export async function createCleanPool(): Promise<pg.Pool> {
  const pool = createPool(env.DATABASE_URL);
  await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  return pool;
}
