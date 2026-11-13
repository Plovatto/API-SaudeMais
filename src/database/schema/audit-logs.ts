import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7Id } from './columns.js';

export const actorTypes = ['user', 'integration', 'system'] as const;
export type ActorType = (typeof actorTypes)[number];

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuidv7Id(),
    actorType: text('actor_type', { enum: actorTypes }).notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: inet('ip'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_created_at_idx').on(table.createdAt),
    check('audit_logs_actor_type_check', sql`actor_type in ('user', 'integration', 'system')`),
    check('audit_logs_actor_check', sql`(actor_type = 'system') = (actor_id is null)`),
    check('audit_logs_action_check', sql`char_length(action) between 1 and 80`),
    check('audit_logs_entity_type_check', sql`char_length(entity_type) <= 40`),
    check('audit_logs_entity_id_check', sql`char_length(entity_id) <= 64`),
    check('audit_logs_metadata_check', sql`jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048`),
  ],
);
