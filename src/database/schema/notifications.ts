import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz, uuidv7Id } from './columns.js';
import { roles, users } from './users.js';

export const notificationTypes = [
  'appointment_requested',
  'appointment_rescheduled',
  'appointment_cancelled_by_patient',
  'appointment_confirmed',
  'appointment_cancelled',
  'appointment_expired',
  'exam_result_available',
  'user_registered',
] as const;
export type NotificationType = (typeof notificationTypes)[number];

export type NotificationParams = Record<string, string | number | boolean | null>;

export const notifications = pgTable(
  'notifications',
  {
    id: uuidv7Id(),
    userId: uuid('user_id').notNull(),
    audienceRole: text('audience_role', { enum: roles }).notNull(),
    type: text('type', { enum: notificationTypes }).notNull(),
    params: jsonb('params').$type<NotificationParams>().notNull().default({}),
    bookingId: uuid('booking_id'),
    readAt: timestamptz('read_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: 'notifications_user_id_fkey', columns: [table.userId], foreignColumns: [users.id] }).onDelete(
      'cascade',
    ),
    index('notifications_user_role_created_at_idx').on(table.userId, table.audienceRole, table.createdAt.desc()),
    index('notifications_user_role_unread_idx')
      .on(table.userId, table.audienceRole)
      .where(sql`read_at is null`),
    check('notifications_audience_role_check', isOneOf('audience_role', roles)),
    check('notifications_type_check', isOneOf('type', notificationTypes)),
    check('notifications_params_check', sql`jsonb_typeof(params) = 'object' and octet_length(params::text) <= 1024`),
    check('notifications_booking_check', sql`(booking_id is null) = (type = 'user_registered')`),
  ],
);
