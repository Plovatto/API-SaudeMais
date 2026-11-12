import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

/** Resolves to `<project>/drizzle` from both `src/database` and `dist/database`. */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Arbitrary constant shared by every instance of the API: whoever holds it is the one migrating.
const MIGRATION_LOCK_ID = 727_001;

/**
 * Applies pending migrations. A session-level advisory lock makes instances that start together
 * run them one after the other, so a migration is never applied twice.
 */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Waiting for the lock and running DDL may legitimately take longer than a request.
    await client.query('SET statement_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    }
    await client.query('RESET statement_timeout');
    client.release();
  } catch (error) {
    // The session state is unknown after a failure, so the connection is discarded, which also frees the lock.
    client.release(true);
    throw error;
  }
}
