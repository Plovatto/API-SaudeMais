import { and, asc, count, desc, eq, gte, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgSelect, PgTable } from 'drizzle-orm/pg-core';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import { bookings, effectiveStatus } from '../../database/schema/bookings.js';
import { examTypes, specialties, units } from '../../database/schema/catalog.js';
import { users } from '../../database/schema/users.js';
import { CLINIC_TIME_ZONE, type DayRange } from '../../lib/time.js';
import { countWhere, startsWithin, statusTotals } from '../bookings/bookings.repository.js';
import { TOP_DOCTORS, TOP_ITEMS } from './admin-reports.model.js';

interface Buckets {
  from: string;
  days: number;
}

interface Ranked {
  table: PgTable;
  id: AnyPgColumn;
  name: AnyPgColumn;
  on: SQL;
}

const cancelledBy = {
  patient: countWhere(eq(bookings.cancelledByRole, 'patient')),
  doctor: countWhere(eq(bookings.cancelledByRole, 'doctor')),
  admin: countWhere(eq(bookings.cancelledByRole, 'admin')),
  system: countWhere(eq(bookings.cancelledByRole, 'system')),
};

const bucketOf = (column: AnyPgColumn, { from, days }: Buckets) =>
  sql<number>`((${column} at time zone ${CLINIC_TIME_ZONE})::date - ${from}::date) / ${days}::int`.mapWith(Number);

const localStart = sql`${bookings.startsAt} at time zone ${CLINIC_TIME_ZONE}`;

const leadHours = sql`greatest(extract(epoch from ${bookings.startsAt} - ${bookings.createdAt}) / 3600, 0)`;

const leadWithin = (min: number | null, max: number | null) =>
  countWhere(
    and(
      min === null ? undefined : sql`${leadHours} >= ${min}`,
      max === null ? undefined : sql`${leadHours} < ${max}`,
    ),
  );

function within<T extends PgSelect>(query: T, range: DayRange) {
  return query.where(startsWithin(range));
}

function topOf(tx: Transaction, range: DayRange, { table, id, name, on }: Ranked) {
  const query = tx.select({ id: sql<string>`${id}`, name: sql<string>`${name}`, total: count() }).from(bookings);
  return within(query.$dynamic(), range)
    .innerJoin(table, on)
    .groupBy(id)
    .orderBy(desc(count()), asc(name))
    .limit(TOP_ITEMS);
}

export class AdminReportsRepository {
  constructor(private readonly db: Database) {}

  report(range: DayRange, buckets: Buckets, now: Date) {
    return this.db.transaction(
      async (tx) => ({
        kinds: await within(
          tx
            .select({
              kind: bookings.kind,
              ...statusTotals(now),
              lateCancellations: countWhere(eq(bookings.lateCancellation, true)),
              cancelledBy,
            })
            .from(bookings)
            .$dynamic(),
          range,
        ).groupBy(bookings.kind),
        series: await within(
          tx
            .select({ bucket: bucketOf(bookings.startsAt, buckets), ...statusTotals(now) })
            .from(bookings)
            .$dynamic(),
          range,
        ).groupBy(sql`1`),
        topSpecialties: await topOf(tx, range, {
          table: specialties,
          id: specialties.id,
          name: specialties.name,
          on: eq(specialties.id, bookings.specialtyId),
        }),
        topExamTypes: await topOf(tx, range, {
          table: examTypes,
          id: examTypes.id,
          name: examTypes.name,
          on: eq(examTypes.id, bookings.examTypeId),
        }),
      }),
      readSnapshot,
    );
  }

  insights(range: DayRange, buckets: Buckets, now: Date) {
    const { completed, noShow, cancelled } = statusTotals(now);
    const outcomes = { completed, noShow, cancelled };
    return this.db.transaction(
      async (tx) => ({
        heatmap: await tx
          .select({
            weekday: sql<number>`extract(isodow from ${localStart})`.mapWith(Number),
            hour: sql<number>`extract(hour from ${localStart})`.mapWith(Number),
            total: count(),
          })
          .from(bookings)
          .where(and(startsWithin(range), notInArray(effectiveStatus(now), ['cancelled', 'expired'])))
          .groupBy(sql`1`, sql`2`)
          .orderBy(sql`1`, sql`2`),
        leadTime: await within(
          tx
            .select({
              sameDay: leadWithin(null, 24),
              upTo3Days: leadWithin(24, 72),
              upTo7Days: leadWithin(72, 168),
              upTo14Days: leadWithin(168, 336),
              upTo30Days: leadWithin(336, 720),
              over30Days: leadWithin(720, null),
              medianHours: sql<number | null>`percentile_cont(0.5) within group (order by ${leadHours})`.mapWith(
                (value: string | number | null) => (value === null ? null : Math.round(Number(value) * 10) / 10),
              ),
              rescheduledBookings: countWhere(sql`${bookings.rescheduleCount} > 0`),
              reschedules: sql<number>`coalesce(sum(${bookings.rescheduleCount}), 0)`.mapWith(Number),
            })
            .from(bookings)
            .$dynamic(),
          range,
        ),
        doctors: await within(
          tx
            .select({
              id: users.id,
              name: users.fullName,
              total: count(),
              completed: outcomes.completed,
              noShow: outcomes.noShow,
              cancelled: outcomes.cancelled,
            })
            .from(bookings)
            .$dynamic(),
          range,
        )
          .innerJoin(users, eq(users.id, bookings.doctorId))
          .groupBy(users.id)
          .orderBy(desc(count()), asc(users.fullName))
          .limit(TOP_DOCTORS),
        units: await within(
          tx
            .select({
              id: units.id,
              name: units.name,
              total: count(),
              appointments: countWhere(eq(bookings.kind, 'appointment')),
              exams: countWhere(eq(bookings.kind, 'exam')),
              completed: outcomes.completed,
              noShow: outcomes.noShow,
              cancelled: outcomes.cancelled,
            })
            .from(bookings)
            .$dynamic(),
          range,
        )
          .innerJoin(units, eq(units.id, bookings.unitId))
          .groupBy(units.id)
          .orderBy(desc(count()), asc(units.name)),
        signups: await tx
          .select({ bucket: bucketOf(users.createdAt, buckets), total: count() })
          .from(users)
          .where(and(gte(users.createdAt, range.start), lt(users.createdAt, range.end)))
          .groupBy(sql`1`),
      }),
      readSnapshot,
    );
  }
}
