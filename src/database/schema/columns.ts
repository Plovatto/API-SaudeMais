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
