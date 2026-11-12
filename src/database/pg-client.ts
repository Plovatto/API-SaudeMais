import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg, { type PoolConfig } from 'pg';
import { logger } from '../config/logger.js';
import * as schema from './schema/index.js';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function poolOptions(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'api-saudemais',
  };
}

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool(poolOptions(connectionString));
  pool.on('error', (err) => {
    logger.error({ err }, 'Idle database client error');
  });
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
