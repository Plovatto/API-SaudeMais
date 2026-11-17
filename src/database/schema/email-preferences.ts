import { boolean, check, foreignKey, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { isOneOf, timestamptz } from './columns.js';
import { users } from './users.js';

export const emailTopics = [
  'booking_reminder',
  'booking_decision',
  'exam_result',
  'appointment_request',
  'appointment_cancellation',
  'user_registration',
] as const;
export type EmailTopic = (typeof emailTopics)[number];

export const emailPreferences = pgTable(
  'email_preferences',
  {
    userId: uuid('user_id').notNull(),
    topic: text('topic', { enum: emailTopics }).notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'email_preferences_pkey', columns: [table.userId, table.topic] }),
    foreignKey({
      name: 'email_preferences_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check('email_preferences_topic_check', isOneOf('topic', emailTopics)),
  ],
);
