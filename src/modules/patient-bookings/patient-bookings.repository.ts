import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../database/pg-client.js';
import {
  bookings,
  effectiveStatus,
  isActiveFuture,
  isLateCancellation,
  type BookingStatus,
  type VisitType,
} from '../../database/schema/bookings.js';
import { examTypes, specialties, units } from '../../database/schema/catalog.js';
import { users } from '../../database/schema/users.js';
import { pageOf } from '../../lib/pagination.js';
import { cancellationColumns, cancellationOf } from '../bookings/bookings.repository.js';
import type { BookingScope, PatientBookingPage, PatientBookingsQuery } from './patient-bookings.model.js';

const doctorUsers = alias(users, 'doctor_users');

const scopes: Record<BookingScope, (now: Date) => { where: SQL; order: SQL }> = {
  upcoming: (now: Date) => ({ where: isActiveFuture(now), order: asc(bookings.startsAt) }),
  past: (now: Date) => ({ where: sql`not (${isActiveFuture(now)})`, order: desc(bookings.startsAt) }),
};

async function countsOf(tx: Transaction, patientId: string, now: Date) {
  const total = (where: SQL) => sql<number>`count(*) filter (where ${where})`.mapWith(Number);
  const [row] = await tx
    .select({ upcoming: total(scopes.upcoming(now).where), past: total(scopes.past(now).where) })
    .from(bookings)
    .where(eq(bookings.patientId, patientId));
  return row ?? { upcoming: 0, past: 0 };
}

function blockedReason(status: BookingStatus, active: boolean) {
  if (active) return 'unavailable' as const;
  return status === 'confirmed' ? ('started' as const) : ('closed' as const);
}

export class PatientBookingsRepository {
  constructor(private readonly db: Database) {}

  page(patientId: string, query: PatientBookingsQuery, now: Date): Promise<PatientBookingPage> {
    const { scope, kind, status, ...pagination } = query;
    const { where: inScope, order } = scopes[scope](now);
    const where = and(
      eq(bookings.patientId, patientId),
      inScope,
      kind && eq(bookings.kind, kind),
      status && eq(effectiveStatus(now), status),
    );
    return this.db.transaction(
      async (tx) => {
        const select = tx
          .select({
            id: bookings.id,
            kind: bookings.kind,
            status: effectiveStatus(now),
            startsAt: bookings.startsAt,
            endsAt: bookings.endsAt,
            notes: bookings.notes,
            visitType: sql<VisitType | null>`${bookings.visitType}`,
            doctor: { id: doctorUsers.id, fullName: doctorUsers.fullName },
            specialty: { id: specialties.id, name: specialties.name, council: specialties.council },
            examType: { id: examTypes.id, name: examTypes.name },
            publicCode: bookings.publicCode,
            unit: { id: units.id, name: units.name, address: units.address, phone: units.phone },
            cancellation: cancellationColumns,
            active: sql<boolean>`${isActiveFuture(now)}`,
            lateCancellation: sql<boolean>`${isLateCancellation(now)}`,
          })
          .from(bookings)
          .innerJoin(units, eq(units.id, bookings.unitId))
          .leftJoin(doctorUsers, eq(doctorUsers.id, bookings.doctorId))
          .leftJoin(specialties, eq(specialties.id, bookings.specialtyId))
          .leftJoin(examTypes, eq(examTypes.id, bookings.examTypeId))
          .where(where)
          .orderBy(order, asc(bookings.id))
          .$dynamic();
        const page = await pageOf(select, pagination, () => tx.$count(bookings, where));
        return {
          ...page,
          items: page.items.map(({ startsAt, endsAt, active, lateCancellation, cancellation, ...row }) => {
            const canCancel = active && row.kind === 'appointment';
            return {
              ...row,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              cancellation: cancellationOf(cancellation),
              actions: {
                canCancel,
                lateCancellation: canCancel && lateCancellation,
                cancelBlockedReason: canCancel ? null : blockedReason(row.status, active),
              },
            };
          }),
          counts: await countsOf(tx, patientId, now),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
