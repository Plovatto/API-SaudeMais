import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const uuidv7Id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

export const isE164 = (column: string) => sql.raw(`${column} ~ '^\\+[1-9][0-9]{9,14}$'`);

export const timestamps = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const isOneOf = <const T extends readonly [string, ...string[]]>(column: string, values: T) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(', ')})`);
