import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../database/pg-client.js';
import {
  bookingEvents,
  bookings,
  effectiveStatus,
  isActiveFuture,
  type VisitType,
} from '../../database/schema/bookings.js';
import { specialties, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { users, type Role } from '../../database/schema/users.js';
import { slotContext, type SlotContext } from '../doctors/doctors.repository.js';
import type { Appointment } from './appointments.model.js';

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
  includeProtected: boolean;
}

export interface Viewer {
  userId: string;
  roles: Role[];
}

const doctorUsers = alias(users, 'doctor_users');

const iso = (date: Date | null) => date?.toISOString() ?? null;

export class AppointmentsRepository {
  constructor(private readonly db: Database) {}

  book<T>(patientId: string, work: (tx: Transaction, patient: { isProtected: boolean }) => Promise<T>) {
    return this.db.transaction(async (tx): Promise<T | undefined> => {
      const [patient] = await tx
        .select({ isProtected: users.isProtected })
        .from(users)
        .where(and(eq(users.id, patientId), isNull(users.deactivatedAt)))
        .for('no key update');
      return patient ? work(tx, patient) : undefined;
    });
  }

  activeFutureCount(tx: Transaction, patientId: string, now: Date): Promise<number> {
    return tx.$count(bookings, and(eq(bookings.patientId, patientId), isActiveFuture(now)));
  }

  async lockDoctor(
    tx: Transaction,
    { doctorId, specialtyId, includeProtected }: DoctorLock,
  ): Promise<SlotContext | undefined> {
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
    return profiles.length > 0 ? slotContext(tx, doctorId, includeProtected) : undefined;
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
    await tx.insert(bookingEvents).values({
      bookingId: row.id,
      eventType: 'created',
      actorType: 'patient',
      actorUserId: patientId,
      toStatus: 'pending',
      createdAt: now,
    });
    return row.id;
  }

  find(id: string, { userId, roles }: Viewer, now: Date): Promise<Appointment | undefined> {
    const visible =
      or(
        roles.includes('patient') ? eq(bookings.patientId, userId) : undefined,
        roles.includes('doctor') ? eq(bookings.doctorId, userId) : undefined,
      ) ?? sql`false`;
    return this.db.transaction(
      async (tx) => {
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
            specialty: { id: specialties.id, name: specialties.name, council: specialties.council },
            unit: { id: units.id, name: units.name, address: units.address, phone: units.phone },
            createdAt: bookings.createdAt,
          })
          .from(bookings)
          .innerJoin(users, eq(users.id, bookings.patientId))
          .innerJoin(doctorUsers, eq(doctorUsers.id, bookings.doctorId))
          .innerJoin(specialties, eq(specialties.id, bookings.specialtyId))
          .innerJoin(units, eq(units.id, bookings.unitId))
          .where(and(eq(bookings.id, id), eq(bookings.kind, 'appointment'), visible));
        if (!row) return undefined;
        const events = await tx
          .select({
            type: bookingEvents.eventType,
            actorType: bookingEvents.actorType,
            fromStatus: bookingEvents.fromStatus,
            toStatus: bookingEvents.toStatus,
            fromStartsAt: bookingEvents.fromStartsAt,
            toStartsAt: bookingEvents.toStartsAt,
            createdAt: bookingEvents.createdAt,
          })
          .from(bookingEvents)
          .where(eq(bookingEvents.bookingId, id))
          .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));
        return {
          ...row,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          events: events.map((event) => ({
            ...event,
            fromStartsAt: iso(event.fromStartsAt),
            toStartsAt: iso(event.toStartsAt),
            createdAt: event.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
