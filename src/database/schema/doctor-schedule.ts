import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, pgTable, primaryKey, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz, uuidv7Id } from './columns.js';
import { doctorProfiles } from './doctor-profiles.js';

export const doctorScheduleDays = pgTable(
  'doctor_schedule_days',
  {
    doctorId: uuid('doctor_id').notNull(),
    weekday: smallint('weekday').notNull(),
    isActive: boolean('is_active').notNull(),
  },
  (table) => [
    primaryKey({ name: 'doctor_schedule_days_pkey', columns: [table.doctorId, table.weekday] }),
    foreignKey({
      name: 'doctor_schedule_days_doctor_id_fkey',
      columns: [table.doctorId],
      foreignColumns: [doctorProfiles.userId],
    }).onDelete('cascade'),
    check('doctor_schedule_days_weekday_check', sql`weekday between 0 and 6`),
  ],
);

export const doctorScheduleRanges = pgTable(
  'doctor_schedule_ranges',
  {
    id: uuidv7Id(),
    doctorId: uuid('doctor_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startMin: smallint('start_min').notNull(),
    endMin: smallint('end_min').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'doctor_schedule_ranges_day_fkey',
      columns: [table.doctorId, table.weekday],
      foreignColumns: [doctorScheduleDays.doctorId, doctorScheduleDays.weekday],
    }).onDelete('cascade'),
    check('doctor_schedule_ranges_period_check', sql`0 <= start_min and start_min < end_min and end_min <= 1440`),
  ],
);

export const MAX_TIME_OFF_REASON = 80;

export const doctorTimeOff = pgTable(
  'doctor_time_off',
  {
    doctorId: uuid('doctor_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'doctor_time_off_pkey', columns: [table.doctorId, table.date] }),
    foreignKey({
      name: 'doctor_time_off_doctor_id_fkey',
      columns: [table.doctorId],
      foreignColumns: [doctorProfiles.userId],
    }).onDelete('cascade'),
    check('doctor_time_off_reason_check', sql.raw(`char_length(reason) between 1 and ${MAX_TIME_OFF_REASON}`)),
  ],
);
