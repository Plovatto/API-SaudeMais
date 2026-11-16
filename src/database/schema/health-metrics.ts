import { sql } from 'drizzle-orm';
import { check, foreignKey, numeric, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { bookingKinds, bookings } from './bookings.js';
import { timestamptz } from './columns.js';

export const healthMetrics = pgTable(
  'health_metrics',
  {
    bookingId: uuid('booking_id').primaryKey(),
    bookingKind: text('booking_kind', { enum: bookingKinds }).notNull().default('appointment'),
    systolic: smallint('systolic'),
    diastolic: smallint('diastolic'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
    recordedAt: timestamptz('recorded_at').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'health_metrics_booking_kind_fkey',
      columns: [table.bookingId, table.bookingKind],
      foreignColumns: [bookings.id, bookings.kind],
    }).onDelete('restrict'),
    check('health_metrics_booking_kind_check', sql`booking_kind = 'appointment'`),
    check('health_metrics_pressure_pair_check', sql`(systolic is null) = (diastolic is null)`),
    check('health_metrics_systolic_check', sql`systolic between 50 and 300`),
    check('health_metrics_diastolic_check', sql`diastolic between 30 and 200`),
    check('health_metrics_pressure_order_check', sql`systolic > diastolic`),
    check('health_metrics_weight_kg_check', sql`weight_kg between 1 and 500`),
    check('health_metrics_present_check', sql`systolic is not null or weight_kg is not null`),
  ],
);
