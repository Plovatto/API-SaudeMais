import { and, asc, count, desc, eq, gt, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import {
  bookings,
  effectiveStatus,
  isActiveFuture,
  notActiveFuture,
  type BookingStatus,
  type VisitType,
} from '../../database/schema/bookings.js';
import { specialties, units } from '../../database/schema/catalog.js';
import { users } from '../../database/schema/users.js';
import { pageOf } from '../../lib/pagination.js';
import { CLINIC_TIME_ZONE, instantOfWallClock, type DayRange } from '../../lib/time.js';
import { cancellationColumns, countWhere, placeColumns, viewOf } from '../bookings/bookings.repository.js';
import type { AgendaTab, DoctorAppointmentPage, DoctorAppointmentsQuery, DoctorHome } from './doctor-agenda.model.js';

const futureWith = (status: BookingStatus, now: Date) => and(eq(bookings.status, status), gt(bookings.startsAt, now));

const awaitingRecord = (now: Date) => and(eq(bookings.status, 'confirmed'), lte(bookings.startsAt, now));

const withStatus = (status: BookingStatus, now: Date) => countWhere(eq(effectiveStatus(now), status));

const tabs: Record<AgendaTab, (now: Date) => { where: SQL | undefined; order: SQL }> = {
  pending: (now) => ({ where: futureWith('pending', now), order: asc(bookings.startsAt) }),
  confirmed: (now) => ({ where: futureWith('confirmed', now), order: asc(bookings.startsAt) }),
  history: (now) => ({ where: notActiveFuture(now), order: desc(bookings.startsAt) }),
};

const ofDoctor = (doctorId: string) => and(eq(bookings.doctorId, doctorId), eq(bookings.kind, 'appointment'));

async function countsOf(tx: Transaction, doctorId: string, now: Date) {
  const [row] = await tx
    .select({
      pending: countWhere(tabs.pending(now).where),
      confirmed: countWhere(tabs.confirmed(now).where),
      history: countWhere(tabs.history(now).where),
      awaitingRecord: countWhere(awaitingRecord(now)),
    })
    .from(bookings)
    .where(ofDoctor(doctorId));
  return row ?? { pending: 0, confirmed: 0, history: 0, awaitingRecord: 0 };
}

export class DoctorAgendaRepository {
  constructor(private readonly db: Database) {}

  page(doctorId: string, query: DoctorAppointmentsQuery, now: Date): Promise<DoctorAppointmentPage> {
    const { tab, from, ...pagination } = query;
    const { where: inTab, order } = tabs[tab](now);
    const where = and(
      ofDoctor(doctorId),
      inTab,
      from ? gte(bookings.startsAt, instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(from))) : undefined,
    );
    return this.db.transaction(async (tx) => {
      const select = tx
        .select({
          id: bookings.id,
          status: effectiveStatus(now),
          visitType: sql<VisitType>`${bookings.visitType}`,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          notes: bookings.notes,
          patient: { id: users.id, fullName: users.fullName, phone: users.phone },
          ...placeColumns,
          cancellation: cancellationColumns,
          active: sql<boolean>`${isActiveFuture(now)}`,
        })
        .from(bookings)
        .innerJoin(users, eq(users.id, bookings.patientId))
        .innerJoin(specialties, eq(specialties.id, bookings.specialtyId))
        .innerJoin(units, eq(units.id, bookings.unitId))
        .where(where)
        .orderBy(order, asc(bookings.id))
        .$dynamic();
      const page = await pageOf(select, pagination, () => tx.$count(bookings, where));
      return {
        ...page,
        items: page.items.map(({ active, ...row }) => ({
          ...viewOf(row),
          actions: { canConfirm: row.status === 'pending', canCancel: active },
        })),
        counts: await countsOf(tx, doctorId, now),
      };
    }, readSnapshot);
  }

  async today(doctorId: string, { start, end }: DayRange, now: Date): Promise<Omit<DoctorHome['today'], 'date'>> {
    const [row] = await this.db
      .select({
        total: count(),
        pending: countWhere(tabs.pending(now).where),
        confirmed: countWhere(tabs.confirmed(now).where),
        awaitingRecord: countWhere(awaitingRecord(now)),
        completed: withStatus('completed', now),
        noShow: withStatus('no_show', now),
        cancelled: withStatus('cancelled', now),
        expired: withStatus('expired', now),
      })
      .from(bookings)
      .where(and(ofDoctor(doctorId), gte(bookings.startsAt, start), lt(bookings.startsAt, end)));
    return (
      row ?? {
        total: 0,
        pending: 0,
        confirmed: 0,
        awaitingRecord: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
        expired: 0,
      }
    );
  }
}
