import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgSelect, PgTable } from 'drizzle-orm/pg-core';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import { bookings } from '../../database/schema/bookings.js';
import { examTypes, specialties } from '../../database/schema/catalog.js';
import { users } from '../../database/schema/users.js';
import { CLINIC_TIME_ZONE, type DayRange } from '../../lib/time.js';
import { countWhere, startsWithin, statusTotals } from '../bookings/bookings.repository.js';
import { TOP_ITEMS } from './admin-reports.model.js';

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

const bucketOf = ({ from, days }: Buckets) =>
  sql<number>`((${bookings.startsAt} at time zone ${CLINIC_TIME_ZONE})::date - ${from}::date) / ${days}::int`.mapWith(
    Number,
  );

function ofRealPatients<T extends PgSelect>(query: T, range: DayRange) {
  return query
    .innerJoin(users, eq(users.id, bookings.patientId))
    .where(and(eq(users.isProtected, false), startsWithin(range)));
}

function topOf(tx: Transaction, range: DayRange, { table, id, name, on }: Ranked) {
  const query = tx.select({ id: sql<string>`${id}`, name: sql<string>`${name}`, total: count() }).from(bookings);
  return ofRealPatients(query.$dynamic(), range)
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
        kinds: await ofRealPatients(
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
        series: await ofRealPatients(
          tx
            .select({ bucket: bucketOf(buckets), ...statusTotals(now) })
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
}
