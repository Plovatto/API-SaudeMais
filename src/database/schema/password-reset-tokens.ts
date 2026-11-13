import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7Id } from './columns.js';
import { users } from './users.js';

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuidv7Id(),
    userId: uuid('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    requestedBy: uuid('requested_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    sentAt: timestamptz('sent_at'),
    usedAt: timestamptz('used_at'),
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [
    unique('password_reset_tokens_token_hash_key').on(table.tokenHash),
    foreignKey({
      name: 'password_reset_tokens_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'password_reset_tokens_requested_by_fkey',
      columns: [table.requestedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    uniqueIndex('password_reset_tokens_one_open_per_user_key')
      .on(table.userId)
      .where(sql`used_at is null and revoked_at is null`),
    index('password_reset_tokens_user_id_created_at_idx').on(table.userId, table.createdAt),
    index('password_reset_tokens_created_at_idx').on(table.createdAt),
    check('password_reset_tokens_token_hash_check', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('password_reset_tokens_period_check', sql`expires_at > created_at`),
    check('password_reset_tokens_single_outcome_check', sql`used_at is null or revoked_at is null`),
  ],
);
