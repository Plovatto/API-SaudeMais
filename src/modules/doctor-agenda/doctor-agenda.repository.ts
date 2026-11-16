import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import {
  bookings,
  effectiveStatus,
  isAwaitingRecord,
  notActiveFuture,
  type VisitType,
} from '../../database/schema/bookings.js';
import { specialties, units } from '../../database/schema/catalog.js';
import { users } from '../../database/schema/users.js';
import { pageOf, type Pagination } from '../../lib/pagination.js';
import { CLINIC_TIME_ZONE, instantOfWallClock, type DayRange } from '../../lib/time.js';
import { doctorActions } from '../bookings/booking-policy.js';
import {
  cancellationColumns,
  countWhere,
  futureWith,
  noStatusTotals,
  placeColumns,
  startsWithin,
  statusTotals,
  viewOf,
} from '../bookings/bookings.repository.js';
import type { AgendaTab, DoctorAppointmentPage, DoctorAppointmentsQuery } from './doctor-agenda.model.js';

const HOME_ITEMS = 3;

const tabs: Record<AgendaTab, (now: Date) => { where: SQL | undefined; order: SQL }> = {
  pending: (now) => ({ where: futureWith('pending', now), order: asc(bookings.startsAt) }),
  confirmed: (now) => ({ where: futureWith('confirmed', now), order: asc(bookings.startsAt) }),
  awaiting: (now) => ({ where: isAwaitingRecord(now), order: asc(bookings.startsAt) }),
  history: (now) => ({ where: notActiveFuture(now), order: desc(bookings.startsAt) }),
};

const ofDoctor = (doctorId: string) => and(eq(bookings.doctorId, doctorId), eq(bookings.kind, 'appointment'));

const reachablePhone = (now: Date) =>
  sql<
    string | null
  >`case when ${effectiveStatus(now)} in ('pending', 'confirmed', 'completed', 'no_show') then ${users.phone} end`;

interface Listing extends Pagination {
  doctorId: string;
  tab: AgendaTab;
  from?: string | undefined;
  now: Date;
}

async function list(tx: Transaction, { doctorId, tab, from, now, ...pagination }: Listing) {
  const { where: inTab, order } = tabs[tab](now);
  const where = and(
    ofDoctor(doctorId),
    inTab,
    from ? gte(bookings.startsAt, instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(from))) : undefined,
  );
  const select = tx
    .select({
      id: bookings.id,
      status: effectiveStatus(now),
      visitType: sql<VisitType>`${bookings.visitType}`,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      notes: bookings.notes,
      patient: { id: users.id, fullName: users.fullName, phone: reachablePhone(now) },
      ...placeColumns,
      cancellation: cancellationColumns,
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
    items: page.items.map((row) => ({ ...viewOf(row), actions: doctorActions(row, now) })),
  };
}

async function countsOf(tx: Transaction, doctorId: string, now: Date) {
  const [row] = await tx
    .select({
      pending: countWhere(tabs.pending(now).where),
      confirmed: countWhere(tabs.confirmed(now).where),
      awaiting: countWhere(tabs.awaiting(now).where),
      history: countWhere(tabs.history(now).where),
    })
    .from(bookings)
    .where(ofDoctor(doctorId));
  return row ?? { pending: 0, confirmed: 0, awaiting: 0, history: 0 };
}

async function todayOf(tx: Transaction, doctorId: string, day: DayRange, now: Date) {
  const [row] = await tx
    .select(statusTotals(now))
    .from(bookings)
    .where(and(ofDoctor(doctorId), startsWithin(day)));
  return row ?? noStatusTotals;
}

export class DoctorAgendaRepository {
  constructor(private readonly db: Database) {}

  page(
    doctorId: string,
    { tab, from, ...pagination }: DoctorAppointmentsQuery,
    now: Date,
  ): Promise<DoctorAppointmentPage> {
    return this.db.transaction(
      async (tx) => ({
        ...(await list(tx, { doctorId, tab, from, now, ...pagination })),
        counts: await countsOf(tx, doctorId, now),
      }),
      readSnapshot,
    );
  }

  home(doctorId: string, day: DayRange, now: Date) {
    const first = (tab: AgendaTab, tx: Transaction) =>
      list(tx, { doctorId, tab, now, page: 1, pageSize: HOME_ITEMS }).then((page) => page.items);
    return this.db.transaction(
      async (tx) => ({
        today: await todayOf(tx, doctorId, day, now),
        pending: await first('pending', tx),
        awaitingRecord: await first('awaiting', tx),
        counts: await countsOf(tx, doctorId, now),
      }),
      readSnapshot,
    );
  }
}
