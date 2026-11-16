import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { bookingKinds, bookings } from './bookings.js';
import { isOneOf, timestamptz, uuidv7Id } from './columns.js';
import { integrationClients } from './integration-clients.js';

export const resultStatuses = ['final', 'amended'] as const;
export const resultFlags = ['normal', 'low', 'high', 'critical'] as const;

export const examResults = pgTable(
  'exam_results',
  {
    id: uuidv7Id(),
    bookingId: uuid('booking_id').notNull(),
    bookingKind: text('booking_kind', { enum: bookingKinds }).notNull().default('exam'),
    clientId: uuid('client_id').notNull(),
    externalId: text('external_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'exam_results_booking_kind_fkey',
      columns: [table.bookingId, table.bookingKind],
      foreignColumns: [bookings.id, bookings.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'exam_results_client_id_fkey',
      columns: [table.clientId],
      foreignColumns: [integrationClients.id],
    }).onDelete('restrict'),
    unique('exam_results_booking_id_key').on(table.bookingId),
    unique('exam_results_client_external_id_key').on(table.clientId, table.externalId),
    check('exam_results_booking_kind_check', sql`booking_kind = 'exam'`),
    check('exam_results_external_id_check', sql`char_length(external_id) between 1 and 64`),
  ],
);

export const examResultVersions = pgTable(
  'exam_result_versions',
  {
    resultId: uuid('result_id').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: resultStatuses }).notNull(),
    issuedAt: timestamptz('issued_at').notNull(),
    receivedAt: timestamptz('received_at').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({ name: 'exam_result_versions_pkey', columns: [table.resultId, table.version] }),
    foreignKey({
      name: 'exam_result_versions_result_id_fkey',
      columns: [table.resultId],
      foreignColumns: [examResults.id],
    }).onDelete('cascade'),
    check('exam_result_versions_version_check', sql`version >= 1`),
    check('exam_result_versions_status_check', isOneOf('status', resultStatuses)),
    check(
      'exam_result_versions_payload_check',
      sql`jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536`,
    ),
  ],
);

export const hasResult = sql<boolean>`exists (select 1 from ${examResults} where ${examResults.bookingId} = ${bookings.id})`;
