import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../database/pg-client.js';
import { settings } from '../database/schema/catalog.js';

type Selection = Record<string, PgColumn>;
type Selected<T extends Selection> = { [K in keyof T]: T[K]['_']['data'] };

export async function readSettings<T extends Selection>(
  db: Pick<Database, 'select'>,
  columns: T,
): Promise<Selected<T>> {
  const [row] = await db.select(columns).from(settings);
  if (!row) throw new Error('Settings row is missing');
  return row as Selected<T>;
}
