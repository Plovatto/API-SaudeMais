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
import { pageOf, type Pagination } from '../../lib/pagination.js';
import { CLINIC_TIME_ZONE, instantOfWallClock, type DayRange } from '../../lib/time.js';
import { cancellationColumns, countWhere, placeColumns, viewOf } from '../bookings/bookings.repository.js';
import type { AgendaTab, DoctorAppointmentPage, DoctorAppointmentsQuery } from './doctor-agenda.model.js';

const HOME_ITEMS = 3;

const futureWith = (status: BookingStatus, now: Date) => and(eq(bookings.status, status), gt(bookings.startsAt, now));

const withStatus = (status: BookingStatus, now: Date) => countWhere(eq(effectiveStatus(now), status));

const tabs: Record<AgendaTab, (now: Date) => { where: SQL | undefined; order: SQL }> = {
  pending: (now) => ({ where: futureWith('pending', now), order: asc(bookings.startsAt) }),
  confirmed: (now) => ({ where: futureWith('confirmed', now), order: asc(bookings.startsAt) }),
  awaiting: (now) => ({
    where: and(eq(bookings.status, 'confirmed'), lte(bookings.startsAt, now)),
    order: asc(bookings.startsAt),
  }),
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
    items: page.items.map(({ active, ...row }) => {
      const awaiting = row.status === 'confirmed' && !active;
      return {
        ...viewOf(row),
        actions: {
          canConfirm: row.status === 'pending',
          canCancel: active,
          canComplete: awaiting,
          canNoShow: awaiting,
        },
      };
    }),
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

async function todayOf(tx: Transaction, doctorId: string, { start, end }: DayRange, now: Date) {
  const [row] = await tx
    .select({
      total: count(),
      pending: countWhere(tabs.pending(now).where),
      confirmed: countWhere(tabs.confirmed(now).where),
      awaitingRecord: countWhere(tabs.awaiting(now).where),
      completed: withStatus('completed', now),
      noShow: withStatus('no_show', now),
      cancelled: withStatus('cancelled', now),
      expired: withStatus('expired', now),
    })
    .from(bookings)
    .where(and(ofDoctor(doctorId), gte(bookings.startsAt, start), lt(bookings.startsAt, end)));
  return (
    row ?? { total: 0, pending: 0, confirmed: 0, awaitingRecord: 0, completed: 0, noShow: 0, cancelled: 0, expired: 0 }
  );
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
