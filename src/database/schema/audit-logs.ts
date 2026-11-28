import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz, uuidv7Id } from './columns.js';

export const auditActions = [
  'user.created',
  'user.updated',
  'user.deactivated',
  'user.reactivated',
  'user.password_reset_sent',
  'user.role_granted',
  'user.role_revoked',
  'doctor_profile.created',
  'doctor_profile.updated',
  'doctor_profile.deleted',
  'doctor_schedule.saved',
  'doctor_time_off.created',
  'doctor_time_off.deleted',
  'specialty.created',
  'specialty.updated',
  'specialty.activated',
  'specialty.deactivated',
  'unit.created',
  'unit.updated',
  'unit.activated',
  'unit.deactivated',
  'exam_type.created',
  'exam_type.updated',
  'exam_type.activated',
  'exam_type.deactivated',
  'unit_exam_offer.saved',
  'policy.updated',
  'integration_client.created',
  'integration_client.revoked',
  'exam_result.created',
  'exam_result.amended',
  'exam_result.read',
  'announcement.created',
  'announcement.updated',
  'announcement.deleted',
] as const;
export type AuditAction = (typeof auditActions)[number];

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
    index('audit_logs_actor_id_id_idx')
      .on(table.actorId, table.id.desc())
      .where(sql`actor_id is not null`),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId, table.id.desc()),
    index('audit_logs_action_id_idx').on(table.action, table.id.desc()),
    check('audit_logs_actor_type_check', isOneOf('actor_type', actorTypes)),
    check('audit_logs_actor_check', sql`(actor_type = 'system') = (actor_id is null)`),
    check('audit_logs_action_check', sql`char_length(action) between 1 and 80`),
    check('audit_logs_entity_type_check', sql`char_length(entity_type) <= 40`),
    check('audit_logs_entity_id_check', sql`char_length(entity_id) <= 64`),
    check('audit_logs_metadata_check', sql`jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 2048`),
  ],
);
