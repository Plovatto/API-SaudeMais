import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns.js';
import { specialties, units } from './catalog.js';
import { users } from './users.js';

export const APPOINTMENT_DURATIONS = [15, 20, 30, 45, 60] as const;
export type AppointmentDuration = (typeof APPOINTMENT_DURATIONS)[number];

export const doctorProfiles = pgTable(
  'doctor_profiles',
  {
    userId: uuid('user_id').primaryKey(),
    specialtyId: uuid('specialty_id').notNull(),
    council: text('council').notNull(),
    unitId: uuid('unit_id').notNull(),
    registryNumber: text('registry_number').notNull(),
    registryUf: text('registry_uf').notNull(),
    appointmentDurationMin: smallint('appointment_duration_min').$type<AppointmentDuration>(),
    ...timestamps(),
  },
  (table) => [
    foreignKey({ name: 'doctor_profiles_user_id_fkey', columns: [table.userId], foreignColumns: [users.id] }).onDelete(
      'restrict',
    ),
    foreignKey({
      name: 'doctor_profiles_specialty_council_fkey',
      columns: [table.specialtyId, table.council],
      foreignColumns: [specialties.id, specialties.council],
    }).onDelete('restrict'),
    foreignKey({ name: 'doctor_profiles_unit_id_fkey', columns: [table.unitId], foreignColumns: [units.id] }).onDelete(
      'restrict',
    ),
    unique('doctor_profiles_registry_key').on(table.council, table.registryUf, table.registryNumber),
    index('doctor_profiles_specialty_id_idx').on(table.specialtyId),
    index('doctor_profiles_unit_id_idx').on(table.unitId),
    check('doctor_profiles_registry_number_check', sql`registry_number ~ '^[1-9][0-9]{0,9}$'`),
    check('doctor_profiles_registry_uf_check', sql`registry_uf ~ '^[A-Z]{2}$'`),
    check(
      'doctor_profiles_appointment_duration_min_check',
      sql.raw(`appointment_duration_min in (${APPOINTMENT_DURATIONS.join(', ')})`),
    ),
  ],
);

export const appointmentDuration =
  sql<number>`coalesce(${doctorProfiles.appointmentDurationMin}, ${specialties.appointmentDurationMin})`.mapWith(Number);
