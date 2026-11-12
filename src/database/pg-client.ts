import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg, { type PoolConfig } from 'pg';
import { logger } from '../config/logger.js';
import * as schema from './schema/index.js';

/** Driver-independent database type, so repositories work with node-postgres and with PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Small pool with every wait bounded: the database is a free-tier instance that scales to zero,
 * so connections must be few, short-lived when idle and never block a request forever.
 */
export function poolOptions(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'api-saudemais',
  };
}

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool(poolOptions(connectionString));
  // Without a listener, an error on an idle client (e.g. the database suspending) would crash the process.
  pool.on('error', (err) => {
    logger.error({ err }, 'Idle database client error');
  });
  return pool;
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}
