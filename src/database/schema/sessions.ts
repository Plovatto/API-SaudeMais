import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, inet, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7Id } from './columns.js';
import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    id: uuidv7Id(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    remember: boolean('remember').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: timestamptz('created_at').notNull(),
    lastUsedAt: timestamptz('last_used_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    absoluteExpiresAt: timestamptz('absolute_expires_at').notNull(),
  },
  (table) => [
    unique('sessions_token_hash_key').on(table.tokenHash),
    foreignKey({
      name: 'sessions_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    index('sessions_user_id_idx').on(table.userId),
    check('sessions_token_hash_check', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('sessions_user_agent_check', sql`char_length(user_agent) <= 512`),
    check('sessions_period_check', sql`created_at < expires_at and expires_at <= absolute_expires_at`),
  ],
);
