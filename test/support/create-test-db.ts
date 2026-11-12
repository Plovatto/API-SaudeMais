import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from '@/database/migrate.js';
import * as schema from '@/database/schema/index.js';

/** In-memory PostgreSQL (PGlite) with the real migrations applied. One isolated database per call. */
export async function createTestDb() {
  const client = new PGlite({ extensions: { citext, btree_gist } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
