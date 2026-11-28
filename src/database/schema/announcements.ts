import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamps, timestamptz, uuidv7Id } from './columns.js';
import { roles, users } from './users.js';

export const announcementSeverities = ['info', 'warning', 'critical'] as const;
export type AnnouncementSeverity = (typeof announcementSeverities)[number];

export const MAX_ANNOUNCEMENT_TITLE = 80;
export const MAX_ANNOUNCEMENT_BODY = 500;

const roleList = roles.map((role) => `'${role}'`).join(', ');

export const announcements = pgTable(
  'announcements',
  {
    id: uuidv7Id(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    severity: text('severity', { enum: announcementSeverities }).notNull().default('info'),
    audienceRoles: text('audience_roles', { enum: roles }).array().notNull(),
    startsAt: timestamptz('starts_at').notNull().defaultNow(),
    endsAt: timestamptz('ends_at'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ...timestamps(),
  },
  (table) => [
    foreignKey({ name: 'announcements_created_by_fkey', columns: [table.createdBy], foreignColumns: [users.id] }).onDelete(
      'set null',
    ),
    foreignKey({ name: 'announcements_updated_by_fkey', columns: [table.updatedBy], foreignColumns: [users.id] }).onDelete(
      'set null',
    ),
    index('announcements_active_idx').on(table.startsAt, table.endsAt),
    check(
      'announcements_title_check',
      sql.raw(`char_length(title) between 1 and ${MAX_ANNOUNCEMENT_TITLE} and title ~ '\\S'`),
    ),
    check(
      'announcements_body_check',
      sql.raw(`char_length(body) between 1 and ${MAX_ANNOUNCEMENT_BODY} and body ~ '\\S'`),
    ),
    check('announcements_severity_check', isOneOf('severity', announcementSeverities)),
    check('announcements_ends_at_check', sql`ends_at is null or ends_at > starts_at`),
    check(
      'announcements_audience_roles_check',
      sql.raw(`cardinality(audience_roles) >= 1 and audience_roles <@ array[${roleList}]::text[]`),
    ),
  ],
);
