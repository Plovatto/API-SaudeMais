import { and, asc, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import {
  bookings,
  effectiveStatus,
  isActiveFuture,
  notActiveFuture,
  type VisitType,
} from '../../database/schema/bookings.js';
import { examTypes, specialties, units } from '../../database/schema/catalog.js';
import { healthMetrics } from '../../database/schema/health-metrics.js';
import { users } from '../../database/schema/users.js';
import { pageOf } from '../../lib/pagination.js';
import { latestMetrics } from '../appointments/appointments.repository.js';
import {
  actionsAt,
  cancellationColumns,
  countWhere,
  hasResult,
  placeColumns,
  splitActions,
  viewOf,
} from '../bookings/bookings.repository.js';
import type {
  BookingScope,
  PatientBookingPage,
  PatientBookingsQuery,
  PatientMetrics,
} from './patient-bookings.model.js';

const doctorUsers = alias(users, 'doctor_users');

const scopes: Record<BookingScope, (now: Date) => { where: SQL; order: SQL }> = {
  upcoming: (now: Date) => ({ where: isActiveFuture(now), order: asc(bookings.startsAt) }),
  past: (now: Date) => ({ where: notActiveFuture(now), order: desc(bookings.startsAt) }),
};

async function countsOf(tx: Transaction, patientId: string, now: Date) {
  const [row] = await tx
    .select({ upcoming: countWhere(scopes.upcoming(now).where), past: countWhere(scopes.past(now).where) })
    .from(bookings)
    .where(eq(bookings.patientId, patientId));
  return row ?? { upcoming: 0, past: 0 };
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
    return this.db.transaction(async (tx) => {
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
          examType: { id: examTypes.id, name: examTypes.name },
          publicCode: bookings.publicCode,
          hasResult,
          ...placeColumns,
          cancellation: cancellationColumns,
          rescheduleCount: bookings.rescheduleCount,
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
      const actionsOf = await actionsAt(tx, now);
      return {
        ...page,
        items: page.items.map((row) => {
          const { view, actions } = splitActions(row, row.kind, actionsOf);
          return { ...viewOf(view), actions };
        }),
        counts: await countsOf(tx, patientId, now),
      };
    }, readSnapshot);
  }

  metrics(patientId: string): Promise<PatientMetrics> {
    return this.db.transaction(async (tx) => {
      const ofPatient = eq(bookings.patientId, patientId);
      const pressure = await latestMetrics(tx, and(ofPatient, isNotNull(healthMetrics.systolic)));
      const weight = await latestMetrics(tx, and(ofPatient, isNotNull(healthMetrics.weightKg)));
      const { systolic, diastolic } = pressure ?? {};
      return {
        bloodPressure:
          pressure && systolic != null && diastolic != null
            ? { systolic, diastolic, recordedAt: pressure.recordedAt }
            : null,
        weight: weight?.weightKg != null ? { kg: weight.weightKg, recordedAt: weight.recordedAt } : null,
      };
    }, readSnapshot);
  }
}
