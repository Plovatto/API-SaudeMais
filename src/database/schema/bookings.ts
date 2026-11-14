import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { specialties, unitExamOffers, units } from './catalog.js';
import { isOneOf, timestamps, timestamptz, uuidv7Id } from './columns.js';
import { doctorProfiles } from './doctor-profiles.js';
import { users } from './users.js';

const bookingKinds = ['appointment', 'exam'] as const;
export const bookingStatuses = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'expired'] as const;
export const activeBookingStatuses = ['pending', 'confirmed'] as const;
export const visitTypes = ['first_visit', 'routine', 'follow_up', 'exam_review'] as const;
const cancellerRoles = ['patient', 'doctor', 'admin', 'system'] as const;
export const bookingEventTypes = [
  'created',
  'rescheduled',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'expired',
  'result_received',
] as const;
export const bookingActorTypes = ['patient', 'doctor', 'admin', 'system', 'integration'] as const;

export type BookingStatus = (typeof bookingStatuses)[number];
export type VisitType = (typeof visitTypes)[number];

export const bookings = pgTable(
  'bookings',
  {
    id: uuidv7Id(),
    kind: text('kind', { enum: bookingKinds }).notNull(),
    patientId: uuid('patient_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    status: text('status', { enum: bookingStatuses }).notNull(),
    notes: text('notes'),
    rescheduleCount: smallint('reschedule_count').notNull().default(0),
    lateCancellation: boolean('late_cancellation').notNull().default(false),
    cancelReason: text('cancel_reason'),
    cancelledByRole: text('cancelled_by_role', { enum: cancellerRoles }),
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: timestamptz('cancelled_at'),
    doctorId: uuid('doctor_id'),
    specialtyId: uuid('specialty_id'),
    visitType: text('visit_type', { enum: visitTypes }),
    examTypeId: uuid('exam_type_id'),
    publicCode: text('public_code'),
    lane: smallint('lane'),
    ...timestamps(),
  },
  (table) => [
    foreignKey({ name: 'bookings_patient_id_fkey', columns: [table.patientId], foreignColumns: [users.id] }).onDelete(
      'restrict',
    ),
    foreignKey({ name: 'bookings_unit_id_fkey', columns: [table.unitId], foreignColumns: [units.id] }).onDelete(
      'restrict',
    ),
    foreignKey({
      name: 'bookings_cancelled_by_fkey',
      columns: [table.cancelledBy],
      foreignColumns: [users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'bookings_doctor_id_fkey',
      columns: [table.doctorId],
      foreignColumns: [doctorProfiles.userId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'bookings_specialty_id_fkey',
      columns: [table.specialtyId],
      foreignColumns: [specialties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'bookings_exam_offer_fkey',
      columns: [table.unitId, table.examTypeId],
      foreignColumns: [unitExamOffers.unitId, unitExamOffers.examTypeId],
    }).onDelete('restrict'),
    unique('bookings_public_code_key').on(table.publicCode),
    unique('bookings_id_kind_key').on(table.id, table.kind),
    index('bookings_patient_id_starts_at_idx').on(table.patientId, table.startsAt.desc()),
    index('bookings_doctor_id_starts_at_idx')
      .on(table.doctorId, table.startsAt)
      .where(sql`kind = 'appointment'`),
    index('bookings_starts_at_idx').on(table.startsAt),
    check('bookings_kind_check', isOneOf('kind', bookingKinds)),
    check('bookings_status_check', isOneOf('status', bookingStatuses)),
    check('bookings_visit_type_check', isOneOf('visit_type', visitTypes)),
    check('bookings_cancelled_by_role_check', isOneOf('cancelled_by_role', cancellerRoles)),
    check('bookings_notes_check', sql`char_length(notes) <= 500`),
    check('bookings_cancel_reason_check', sql`char_length(cancel_reason) <= 500`),
    check('bookings_reschedule_count_check', sql`reschedule_count between 0 and 10`),
    check('bookings_public_code_check', sql`public_code ~ '^EX-[0-9A-HJKMNP-TV-Z]{6}$'`),
    check('bookings_lane_check', sql`lane between 1 and 50`),
    check('bookings_period_check', sql`ends_at > starts_at and ends_at - starts_at <= interval '4 hours'`),
    check(
      'bookings_kind_columns_check',
      sql`(kind = 'appointment' and doctor_id is not null and specialty_id is not null and visit_type is not null and exam_type_id is null and public_code is null and lane is null) or (kind = 'exam' and doctor_id is null and specialty_id is null and visit_type is null and exam_type_id is not null and public_code is not null and lane is not null and status in ('confirmed', 'cancelled', 'completed'))`,
    ),
    check(
      'bookings_cancellation_check',
      sql`(status = 'cancelled') = (cancelled_at is not null and cancelled_by_role is not null) and (cancelled_at is null) = (cancelled_by_role is null) and (status = 'cancelled' or (not late_cancellation and cancel_reason is null)) and (cancelled_by is null) = (cancelled_by_role is null or cancelled_by_role = 'system') and (cancelled_by_role is distinct from 'doctor' or cancel_reason is not null)`,
    ),
    check('bookings_not_self_check', sql`doctor_id <> patient_id`),
  ],
);

export const bookingEvents = pgTable(
  'booking_events',
  {
    id: uuidv7Id(),
    bookingId: uuid('booking_id').notNull(),
    eventType: text('event_type', { enum: bookingEventTypes }).notNull(),
    actorType: text('actor_type', { enum: bookingActorTypes }).notNull(),
    actorUserId: uuid('actor_user_id'),
    fromStatus: text('from_status', { enum: bookingStatuses }),
    toStatus: text('to_status', { enum: bookingStatuses }).notNull(),
    fromStartsAt: timestamptz('from_starts_at'),
    toStartsAt: timestamptz('to_starts_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'booking_events_booking_id_fkey',
      columns: [table.bookingId],
      foreignColumns: [bookings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'booking_events_actor_user_id_fkey',
      columns: [table.actorUserId],
      foreignColumns: [users.id],
    }).onDelete('restrict'),
    index('booking_events_booking_id_created_at_idx').on(table.bookingId, table.createdAt),
    check('booking_events_event_type_check', isOneOf('event_type', bookingEventTypes)),
    check('booking_events_actor_type_check', isOneOf('actor_type', bookingActorTypes)),
    check('booking_events_from_status_check', isOneOf('from_status', bookingStatuses)),
    check('booking_events_to_status_check', isOneOf('to_status', bookingStatuses)),
    check('booking_events_actor_check', sql`(actor_user_id is null) = (actor_type in ('system', 'integration'))`),
    check(
      'booking_events_reschedule_check',
      sql`(event_type = 'rescheduled') = (from_starts_at is not null) and (event_type = 'rescheduled') = (to_starts_at is not null)`,
    ),
  ],
);
