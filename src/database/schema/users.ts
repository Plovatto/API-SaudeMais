import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { citext, timestamptz, uuidv7Id } from './columns.js';

export const roles = ['patient', 'doctor', 'admin'] as const;
export type Role = (typeof roles)[number];

export const users = pgTable(
  'users',
  {
    id: uuidv7Id(),
    fullName: text('full_name').notNull(),
    email: citext('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    isProtected: boolean('is_protected').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deactivatedAt: timestamptz('deactivated_at'),
  },
  (table) => [
    unique('users_email_key').on(table.email),
    check('users_full_name_check', sql`char_length(full_name) between 2 and 120`),
    check('users_email_check', sql`char_length(email) between 3 and 254`),
    check('users_phone_check', sql`phone ~ '^\\+[1-9][0-9]{9,14}$'`),
    check('users_password_hash_check', sql`char_length(password_hash) between 1 and 512`),
  ],
);

export const termsAcceptances = pgTable(
  'terms_acceptances',
  {
    userId: uuid('user_id').notNull(),
    termsVersion: text('terms_version').notNull(),
    acceptedAt: timestamptz('accepted_at').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'terms_acceptances_pkey',
      columns: [table.userId, table.termsVersion],
    }),
    foreignKey({
      name: 'terms_acceptances_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    check('terms_acceptances_terms_version_check', sql`char_length(terms_version) between 1 and 20`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: roles }).notNull(),
    grantedBy: uuid('granted_by'),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_roles_pkey',
      columns: [table.userId, table.role],
    }),
    foreignKey({
      name: 'user_roles_user_id_fkey',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_roles_granted_by_fkey',
      columns: [table.grantedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),
    check('user_roles_role_check', sql`role in ('patient', 'doctor', 'admin')`),
  ],
);
