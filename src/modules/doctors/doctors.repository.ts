import { and, asc, count, eq, isNull, type SQL } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import type { Database } from '../../database/pg-client.js';
import { settings, specialties, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { doctorScheduleDays, doctorScheduleRanges } from '../../database/schema/doctor-schedule.js';
import { users } from '../../database/schema/users.js';
import { pageOf, type Page } from '../../lib/pagination.js';
import { unaccentMatch } from '../../lib/search.js';
import type { SlotRequest } from '../../lib/time-slots.js';
import { hoursOf } from '../doctor-schedule/doctor-schedule.repository.js';
import { hasRole } from '../users/user.repository.js';
import type { Doctor, DoctorsQuery } from './doctors.model.js';

export type BookingContext = Pick<
  SlotRequest,
  'ranges' | 'unitHours' | 'durationMin' | 'minLeadMinutes' | 'bookingHorizonDays'
>;

const doctorColumns = {
  id: users.id,
  fullName: users.fullName,
  specialty: { id: specialties.id, name: specialties.name, council: specialties.council },
  unit: { id: units.id, name: units.name, address: units.address, phone: units.phone },
  registry: { number: doctorProfiles.registryNumber, uf: doctorProfiles.registryUf },
};

function joinProfile<Q extends PgSelect>(query: Q) {
  return query
    .innerJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .innerJoin(specialties, eq(specialties.id, doctorProfiles.specialtyId))
    .innerJoin(units, eq(units.id, doctorProfiles.unitId));
}

function bookable(includeProtected: boolean): SQL | undefined {
  return and(
    hasRole('doctor'),
    isNull(users.deactivatedAt),
    eq(specialties.isActive, true),
    eq(units.isActive, true),
    includeProtected ? undefined : eq(users.isProtected, false),
  );
}

export class DoctorsRepository {
  constructor(private readonly db: Database) {}

  page({ specialtyId, search, page, pageSize }: DoctorsQuery, includeProtected: boolean): Promise<Page<Doctor>> {
    const where = and(
      bookable(includeProtected),
      specialtyId ? eq(doctorProfiles.specialtyId, specialtyId) : undefined,
      search ? unaccentMatch(users.fullName, search) : undefined,
    );
    const query = joinProfile(this.db.select(doctorColumns).from(users).$dynamic())
      .where(where)
      .orderBy(asc(users.fullName), asc(users.id))
      .$dynamic();
    return pageOf(query, { page, pageSize }, async () => {
      const [row] = await joinProfile(this.db.select({ total: count() }).from(users).$dynamic()).where(where);
      return row?.total ?? 0;
    });
  }

  bookingContext(doctorId: string, includeProtected: boolean): Promise<BookingContext | undefined> {
    return this.db.transaction(
      async (tx) => {
        const [doctor] = await joinProfile(
          tx.select({ durationMin: specialties.appointmentDurationMin, unitId: units.id }).from(users).$dynamic(),
        ).where(and(eq(users.id, doctorId), bookable(includeProtected)));
        if (!doctor) return undefined;
        const ranges = await tx
          .select({
            weekday: doctorScheduleRanges.weekday,
            startMin: doctorScheduleRanges.startMin,
            endMin: doctorScheduleRanges.endMin,
          })
          .from(doctorScheduleRanges)
          .innerJoin(
            doctorScheduleDays,
            and(
              eq(doctorScheduleDays.doctorId, doctorScheduleRanges.doctorId),
              eq(doctorScheduleDays.weekday, doctorScheduleRanges.weekday),
            ),
          )
          .where(and(eq(doctorScheduleRanges.doctorId, doctorId), eq(doctorScheduleDays.isActive, true)));
        const [policy] = await tx
          .select({ minLeadMinutes: settings.minLeadMinutes, bookingHorizonDays: settings.bookingHorizonDays })
          .from(settings);
        if (!policy) throw new Error('Settings row is missing');
        return { durationMin: doctor.durationMin, ranges, unitHours: await hoursOf(tx, doctor.unitId), ...policy };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
