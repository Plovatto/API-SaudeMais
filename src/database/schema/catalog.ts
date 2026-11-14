import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, isE164, isOneOf, timestamps, timestamptz, uuidv7Id } from './columns.js';
import { users } from './users.js';

export const examKinds = ['lab', 'imaging'] as const;
export type ExamKind = (typeof examKinds)[number];

export const specialties = pgTable(
  'specialties',
  {
    id: uuidv7Id(),
    name: citext('name').notNull(),
    council: text('council').notNull(),
    appointmentDurationMin: smallint('appointment_duration_min').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('specialties_name_key').on(table.name),
    unique('specialties_id_council_key').on(table.id, table.council),
    check('specialties_name_check', sql`char_length(name) between 2 and 80`),
    check('specialties_council_check', sql`council ~ '^[A-Z]{3,10}$'`),
    check(
      'specialties_appointment_duration_min_check',
      sql`appointment_duration_min between 10 and 240 and appointment_duration_min % 5 = 0`,
    ),
  ],
);

export const units = pgTable(
  'units',
  {
    id: uuidv7Id(),
    name: citext('name').notNull(),
    address: text('address').notNull(),
    phone: text('phone').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('units_name_key').on(table.name),
    check('units_name_check', sql`char_length(name) between 2 and 80`),
    check('units_address_check', sql`char_length(address) between 5 and 200`),
    check('units_phone_check', isE164('phone')),
  ],
);

export const unitHours = pgTable(
  'unit_hours',
  {
    unitId: uuid('unit_id').notNull(),
    weekday: smallint('weekday').notNull(),
    openMin: smallint('open_min').notNull(),
    closeMin: smallint('close_min').notNull(),
  },
  (table) => [
    primaryKey({ name: 'unit_hours_pkey', columns: [table.unitId, table.weekday] }),
    foreignKey({ name: 'unit_hours_unit_id_fkey', columns: [table.unitId], foreignColumns: [units.id] }).onDelete(
      'cascade',
    ),
    check('unit_hours_weekday_check', sql`weekday between 0 and 6`),
    check('unit_hours_period_check', sql`0 <= open_min and open_min < close_min and close_min <= 1440`),
  ],
);

export const examTypes = pgTable(
  'exam_types',
  {
    id: uuidv7Id(),
    code: text('code').notNull(),
    name: citext('name').notNull(),
    kind: text('kind', { enum: examKinds }).notNull(),
    durationMin: smallint('duration_min').notNull(),
    preparationNotes: text('preparation_notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('exam_types_code_key').on(table.code),
    unique('exam_types_name_key').on(table.name),
    check('exam_types_code_check', sql`code ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check('exam_types_name_check', sql`char_length(name) between 2 and 80`),
    check('exam_types_kind_check', isOneOf('kind', examKinds)),
    check('exam_types_duration_min_check', sql`duration_min between 5 and 240 and duration_min % 5 = 0`),
    check('exam_types_preparation_notes_check', sql`char_length(preparation_notes) <= 1000`),
  ],
);

export const unitExamOffers = pgTable(
  'unit_exam_offers',
  {
    unitId: uuid('unit_id').notNull(),
    examTypeId: uuid('exam_type_id').notNull(),
    capacityPerSlot: smallint('capacity_per_slot').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ name: 'unit_exam_offers_pkey', columns: [table.unitId, table.examTypeId] }),
    foreignKey({ name: 'unit_exam_offers_unit_id_fkey', columns: [table.unitId], foreignColumns: [units.id] }).onDelete(
      'restrict',
    ),
    foreignKey({
      name: 'unit_exam_offers_exam_type_id_fkey',
      columns: [table.examTypeId],
      foreignColumns: [examTypes.id],
    }).onDelete('restrict'),
    index('unit_exam_offers_exam_type_id_idx').on(table.examTypeId),
    check('unit_exam_offers_capacity_per_slot_check', sql`capacity_per_slot between 1 and 50`),
  ],
);

export const settings = pgTable(
  'settings',
  {
    id: boolean('id').primaryKey().default(true),
    appointmentLateWindowHours: smallint('appointment_late_window_hours').notNull().default(24),
    examLateWindowHours: smallint('exam_late_window_hours').notNull().default(2),
    maxReschedules: smallint('max_reschedules').notNull().default(2),
    bookingHorizonDays: smallint('booking_horizon_days').notNull().default(60),
    minLeadMinutes: integer('min_lead_minutes').notNull().default(60),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    foreignKey({ name: 'settings_updated_by_fkey', columns: [table.updatedBy], foreignColumns: [users.id] }).onDelete(
      'set null',
    ),
    check('settings_single_row_check', sql`id`),
    check('settings_appointment_late_window_hours_check', sql`appointment_late_window_hours between 0 and 168`),
    check('settings_exam_late_window_hours_check', sql`exam_late_window_hours between 0 and 168`),
    check('settings_max_reschedules_check', sql`max_reschedules between 0 and 10`),
    check('settings_booking_horizon_days_check', sql`booking_horizon_days between 1 and 365`),
    check('settings_min_lead_minutes_check', sql`min_lead_minutes between 0 and 10080`),
  ],
);
