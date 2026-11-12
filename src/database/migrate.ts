import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

const MIGRATION_LOCK_ID = 727_001;
const LOCK_WAIT = '60s';

export async function runMigrations(pool: pg.Pool, folder = migrationsFolder): Promise<void> {
  const client = await pool.connect();
  let connectionError: Error | undefined;
  const onConnectionError = (err: Error) => {
    connectionError = err;
  };
  client.on('error', onConnectionError);

  try {
    await client.query('SET statement_timeout = 0');
    await client.query(`SET lock_timeout = '${LOCK_WAIT}'`);
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder: folder });
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    await client.query('RESET lock_timeout');
    await client.query('RESET statement_timeout');
    client.off('error', onConnectionError);
    client.release();
  } catch (error) {
    client.off('error', onConnectionError);
    client.release(true);
    throw connectionError ?? error;
  }
}
