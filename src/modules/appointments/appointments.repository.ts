import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import { bookings, effectiveStatus, type VisitType } from '../../database/schema/bookings.js';
import { specialties, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { healthMetrics } from '../../database/schema/health-metrics.js';
import { users, type Role } from '../../database/schema/users.js';
import { doctorActions } from '../bookings/booking-policy.js';
import {
  actionsAt,
  cancellationColumns,
  eventsOf,
  ofAccount,
  placeColumns,
  recordCreated,
  splitActions,
  viewOf,
  type BookingSide,
} from '../bookings/bookings.repository.js';
import { slotContext, type SlotContext } from '../doctors/doctors.repository.js';
import type { Appointment, HealthMetricsInput } from './appointments.model.js';

interface NewAppointment {
  patientId: string;
  doctorId: string;
  visitType: VisitType;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  now: Date;
}

interface DoctorLock {
  doctorId: string;
  specialtyId: string;
  now: Date;
}

interface Party {
  side: BookingSide;
  doctorId: string;
  specialtyId: string;
}

export interface Viewer {
  userId: string;
  roles: Role[];
}

const doctorUsers = alias(users, 'doctor_users');

const visibleTo = ({ userId, roles }: Viewer) =>
  ofAccount(
    userId,
    roles.filter((role): role is BookingSide => role === 'patient' || role === 'doctor'),
  );

const metricColumns = {
  systolic: healthMetrics.systolic,
  diastolic: healthMetrics.diastolic,
  weightKg: sql`${healthMetrics.weightKg}`.mapWith((value: string): number | null => Number(value)),
  recordedAt: healthMetrics.recordedAt,
};

export async function latestMetrics(db: Pick<Database, 'select'>, where: SQL | undefined) {
  const [row] = await db
    .select(metricColumns)
    .from(healthMetrics)
    .innerJoin(bookings, eq(bookings.id, healthMetrics.bookingId))
    .where(where)
    .orderBy(desc(healthMetrics.recordedAt), desc(healthMetrics.bookingId))
    .limit(1);
  return row ? { ...row, recordedAt: row.recordedAt.toISOString() } : null;
}

export function insertMetrics(
  tx: Transaction,
  bookingId: string,
  { weightKg: kg, ...pressure }: HealthMetricsInput,
  recordedAt: Date,
) {
  return tx.insert(healthMetrics).values({ bookingId, ...pressure, weightKg: kg?.toFixed(2), recordedAt });
}

const appointmentWith = (id: string) => and(eq(bookings.id, id), eq(bookings.kind, 'appointment'));

export class AppointmentsRepository {
  constructor(private readonly db: Database) {}

  async lockDoctor(tx: Transaction, { doctorId, specialtyId, now }: DoctorLock): Promise<SlotContext | undefined> {
    await tx.select({ id: specialties.id }).from(specialties).where(eq(specialties.id, specialtyId)).for('share');
    const [unit] = await tx
      .select({ id: units.id })
      .from(doctorProfiles)
      .innerJoin(units, eq(units.id, doctorProfiles.unitId))
      .where(eq(doctorProfiles.userId, doctorId))
      .for('share', { of: units });
    if (!unit) return undefined;
    const profiles = await tx
      .select({ userId: doctorProfiles.userId })
      .from(doctorProfiles)
      .where(and(eq(doctorProfiles.userId, doctorId), eq(doctorProfiles.unitId, unit.id)))
      .for('share');
    return profiles.length > 0 ? slotContext(tx, doctorId, now) : undefined;
  }

  async create(tx: Transaction, appointment: NewAppointment): Promise<string> {
    const { patientId, doctorId, now, ...fields } = appointment;
    const fromProfile = (column: AnyPgColumn): SQL =>
      sql`(${tx.select({ value: column }).from(doctorProfiles).where(eq(doctorProfiles.userId, doctorId))})`;
    const [row] = await tx
      .insert(bookings)
      .values({
        ...fields,
        kind: 'appointment',
        status: 'pending',
        patientId,
        doctorId,
        unitId: fromProfile(doctorProfiles.unitId),
        specialtyId: fromProfile(doctorProfiles.specialtyId),
        createdAt: now,
      })
      .returning({ id: bookings.id });
    if (!row) throw new Error('Booking insert returned no row');
    await recordCreated(tx, { bookingId: row.id, patientId, status: 'pending', now });
    return row.id;
  }

  async partyOf(id: string, viewer: Viewer): Promise<Party | undefined> {
    const [row] = await this.db
      .select({
        patientId: bookings.patientId,
        doctorId: sql<string>`${bookings.doctorId}`,
        specialtyId: sql<string>`${bookings.specialtyId}`,
      })
      .from(bookings)
      .where(and(appointmentWith(id), visibleTo(viewer)));
    if (!row) return undefined;
    const { patientId, ...place } = row;
    return { ...place, side: patientId === viewer.userId ? 'patient' : 'doctor' };
  }

  find(id: string, viewer: Viewer, now: Date): Promise<Appointment | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: bookings.id,
          status: effectiveStatus(now),
          visitType: sql<VisitType>`${bookings.visitType}`,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          notes: bookings.notes,
          patient: { id: users.id, fullName: users.fullName },
          doctor: { id: doctorUsers.id, fullName: doctorUsers.fullName },
          ...placeColumns,
          cancellation: cancellationColumns,
          createdAt: bookings.createdAt,
          rescheduleCount: bookings.rescheduleCount,
        })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.patientId))
        .innerJoin(doctorUsers, eq(doctorUsers.id, bookings.doctorId))
        .innerJoin(specialties, eq(specialties.id, bookings.specialtyId))
        .innerJoin(units, eq(units.id, bookings.unitId))
        .where(and(appointmentWith(id), visibleTo(viewer)));
      if (!row) return undefined;
      const isPatient = row.patient.id === viewer.userId;
      const { view, actions } = splitActions(row, 'appointment', isPatient ? await actionsAt(tx, now) : () => null);
      return {
        ...viewOf(view),
        createdAt: row.createdAt.toISOString(),
        patientActions: actions,
        doctorActions: isPatient ? null : doctorActions(row, now),
        metrics: await latestMetrics(tx, eq(healthMetrics.bookingId, id)),
        events: await eventsOf(tx, id),
      };
    }, readSnapshot);
  }
}
