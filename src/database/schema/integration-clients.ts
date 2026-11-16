import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { citext, timestamptz, uuidv7Id } from './columns.js';
import { users } from './users.js';

export const integrationClients = pgTable(
  'integration_clients',
  {
    id: uuidv7Id(),
    name: citext('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    apiKeyHash: text('api_key_hash').notNull(),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdBy: uuid('created_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('integration_clients_name_key').on(table.name),
    unique('integration_clients_key_prefix_key').on(table.keyPrefix),
    unique('integration_clients_api_key_hash_key').on(table.apiKeyHash),
    foreignKey({
      name: 'integration_clients_created_by_fkey',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('restrict'),
    check('integration_clients_name_check', sql`char_length(name) between 2 and 80`),
    check('integration_clients_key_prefix_check', sql`key_prefix ~ '^[a-z0-9]{8}$'`),
    check('integration_clients_api_key_hash_check', sql`api_key_hash ~ '^[0-9a-f]{64}$'`),
  ],
);
