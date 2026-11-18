import { and, asc, eq, gte, lt, lte } from 'drizzle-orm';
import { readSnapshot, type Database, type Transaction } from '../../database/pg-client.js';
import { bookings, isActiveFuture } from '../../database/schema/bookings.js';
import { specialties, unitHours, units } from '../../database/schema/catalog.js';
import { appointmentDuration, doctorProfiles, type AppointmentDuration } from '../../database/schema/doctor-profiles.js';
import { doctorScheduleDays, doctorScheduleRanges, doctorTimeOff } from '../../database/schema/doctor-schedule.js';
import { recordAudit, type Actor } from '../../lib/audit.js';
import { civilPeriodIn, CLINIC_TIME_ZONE } from '../../lib/time.js';
import { WEEKDAYS } from '../../lib/week.js';
import type {
  CreatedTimeOff,
  Duration,
  Schedule,
  ScheduleDay,
  ScheduleWarning,
  TimeOff,
  UnitHour,
} from './doctor-schedule.model.js';

interface ReplaceRequest {
  doctorId: string;
  days: ScheduleDay[];
  appointmentDurationMin?: AppointmentDuration | null | undefined;
  actor: Actor;
  check: (hours: UnitHour[]) => void;
}

interface BlockRequest {
  doctorId: string;
  date: string;
  reason: string | null;
  actor: Actor;
  now: Date;
}

interface UnblockRequest {
  doctorId: string;
  date: string;
  actor: Actor;
}

type Replaced = Duration & { unitHours: UnitHour[] };

const timeOffColumns = { date: doctorTimeOff.date, reason: doctorTimeOff.reason };

export class DoctorScheduleRepository {
  constructor(private readonly db: Database) {}

  find(doctorId: string): Promise<Schedule | undefined> {
    return this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ unitId: doctorProfiles.unitId })
        .from(doctorProfiles)
        .where(eq(doctorProfiles.userId, doctorId));
      if (!profile) return undefined;
      const days = await tx
        .select({ weekday: doctorScheduleDays.weekday, isActive: doctorScheduleDays.isActive })
        .from(doctorScheduleDays)
        .where(eq(doctorScheduleDays.doctorId, doctorId));
      const ranges = await tx
        .select({
          weekday: doctorScheduleRanges.weekday,
          startMin: doctorScheduleRanges.startMin,
          endMin: doctorScheduleRanges.endMin,
        })
        .from(doctorScheduleRanges)
        .where(eq(doctorScheduleRanges.doctorId, doctorId))
        .orderBy(asc(doctorScheduleRanges.startMin));
      const hours = await hoursOf(tx, profile.unitId);
      return {
        days: WEEKDAYS.map((weekday) => ({
          weekday,
          isActive: days.some((day) => day.weekday === weekday && day.isActive),
          ranges: ranges
            .filter((range) => range.weekday === weekday)
            .map(({ startMin, endMin }) => ({ startMin, endMin })),
        })),
        unitHours: hours,
        ...(await durationOf(tx, doctorId)),
      };
    }, readSnapshot);
  }

  replace({ doctorId, days, appointmentDurationMin, actor, check }: ReplaceRequest): Promise<Replaced | undefined> {
    return this.db.transaction(async (tx) => {
      const unitId = await lockProfile(tx, doctorId);
      if (!unitId) return undefined;
      await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)).for('share');
      const hours = await hoursOf(tx, unitId);
      check(hours);
      await tx.delete(doctorScheduleDays).where(eq(doctorScheduleDays.doctorId, doctorId));
      await insertSchedule(tx, doctorId, days);
      if (appointmentDurationMin !== undefined) {
        await tx.update(doctorProfiles).set({ appointmentDurationMin }).where(eq(doctorProfiles.userId, doctorId));
      }
      const duration = await durationOf(tx, doctorId);
      await recordAudit(tx, {
        ...actor,
        action: 'doctor_schedule.saved',
        entityType: 'doctor_profile',
        entityId: doctorId,
        metadata: {
          activeDays: days.filter((day) => day.isActive).map((day) => day.weekday),
          ranges: days.reduce((total, day) => total + day.ranges.length, 0),
          appointmentDurationMin: duration.isSpecialtyDefault ? null : duration.appointmentDurationMin,
        },
      });
      return { unitHours: hours, ...duration };
    });
  }

  ensure(doctorId: string, days: ScheduleDay[]): Promise<void> {
    return this.db.transaction(async (tx) => {
      if (!(await lockProfile(tx, doctorId))) return;
      const created = await tx
        .insert(doctorScheduleDays)
        .values(dayRows(doctorId, days))
        .onConflictDoNothing()
        .returning({ weekday: doctorScheduleDays.weekday });
      const ranges = rangeRows(
        doctorId,
        days.filter((day) => created.some((row) => row.weekday === day.weekday)),
      );
      if (ranges.length > 0) await tx.insert(doctorScheduleRanges).values(ranges);
    });
  }

  timeOff(doctorId: string, since: string): Promise<TimeOff[] | undefined> {
    return this.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ userId: doctorProfiles.userId })
        .from(doctorProfiles)
        .where(eq(doctorProfiles.userId, doctorId));
      if (!profile) return undefined;
      return tx
        .select(timeOffColumns)
        .from(doctorTimeOff)
        .where(and(eq(doctorTimeOff.doctorId, doctorId), gte(doctorTimeOff.date, since)))
        .orderBy(asc(doctorTimeOff.date));
    }, readSnapshot);
  }

  block({ doctorId, date, reason, actor, now }: BlockRequest): Promise<CreatedTimeOff | 'missing' | 'exists'> {
    return this.db.transaction(async (tx) => {
      if (!(await lockProfile(tx, doctorId))) return 'missing';
      const [created] = await tx
        .insert(doctorTimeOff)
        .values({ doctorId, date, reason, createdAt: now })
        .onConflictDoNothing()
        .returning(timeOffColumns);
      if (!created) return 'exists';
      await recordAudit(tx, {
        ...actor,
        action: 'doctor_time_off.created',
        entityType: 'doctor_profile',
        entityId: doctorId,
        metadata: { date },
      });
      return { ...created, warnings: await appointmentsOn(tx, doctorId, date, now) };
    });
  }

  unblock({ doctorId, date, actor }: UnblockRequest): Promise<'missing' | 'absent' | 'deleted'> {
    return this.db.transaction(async (tx) => {
      if (!(await lockProfile(tx, doctorId))) return 'missing';
      const deleted = await tx
        .delete(doctorTimeOff)
        .where(and(eq(doctorTimeOff.doctorId, doctorId), eq(doctorTimeOff.date, date)))
        .returning({ date: doctorTimeOff.date });
      if (deleted.length === 0) return 'absent';
      await recordAudit(tx, {
        ...actor,
        action: 'doctor_time_off.deleted',
        entityType: 'doctor_profile',
        entityId: doctorId,
        metadata: { date },
      });
      return 'deleted';
    });
  }
}

async function lockProfile(tx: Transaction, doctorId: string): Promise<string | undefined> {
  const [profile] = await tx
    .select({ unitId: doctorProfiles.unitId })
    .from(doctorProfiles)
    .where(eq(doctorProfiles.userId, doctorId))
    .for('no key update');
  return profile?.unitId;
}

async function durationOf(tx: Transaction, doctorId: string): Promise<Duration> {
  const [row] = await tx
    .select({
      appointmentDurationMin: appointmentDuration,
      specialtyDurationMin: specialties.appointmentDurationMin,
      own: doctorProfiles.appointmentDurationMin,
    })
    .from(doctorProfiles)
    .innerJoin(specialties, eq(specialties.id, doctorProfiles.specialtyId))
    .where(eq(doctorProfiles.userId, doctorId));
  if (!row) throw new Error('Doctor profile disappeared inside its transaction');
  const { own, ...duration } = row;
  return { ...duration, isSpecialtyDefault: own === null };
}

async function appointmentsOn(tx: Transaction, doctorId: string, date: string, now: Date): Promise<ScheduleWarning[]> {
  const { start, end } = civilPeriodIn(CLINIC_TIME_ZONE, { from: date, to: date });
  const rows = await tx
    .select({ appointmentId: bookings.id, startsAt: bookings.startsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.doctorId, doctorId),
        eq(bookings.kind, 'appointment'),
        isActiveFuture(now),
        gte(bookings.startsAt, start),
        lt(bookings.startsAt, end),
      ),
    )
    .orderBy(asc(bookings.startsAt));
  return rows.map(({ appointmentId, startsAt }) => ({ appointmentId, startsAt: startsAt.toISOString() }));
}

export async function blockedDatesFrom(
  db: Pick<Database, 'select'>,
  doctorId: string,
  { from, to }: { from: string; to: string },
): Promise<string[]> {
  const rows = await db
    .select({ date: doctorTimeOff.date })
    .from(doctorTimeOff)
    .where(and(eq(doctorTimeOff.doctorId, doctorId), gte(doctorTimeOff.date, from), lte(doctorTimeOff.date, to)));
  return rows.map((row) => row.date);
}

export function hoursOf(db: Pick<Database, 'select'>, unitId: string): Promise<UnitHour[]> {
  return db
    .select({ weekday: unitHours.weekday, openMin: unitHours.openMin, closeMin: unitHours.closeMin })
    .from(unitHours)
    .where(eq(unitHours.unitId, unitId))
    .orderBy(asc(unitHours.weekday));
}

function dayRows(doctorId: string, days: ScheduleDay[]) {
  return days.map(({ weekday, isActive }) => ({ doctorId, weekday, isActive }));
}

function rangeRows(doctorId: string, days: ScheduleDay[]) {
  return days.flatMap(({ weekday, ranges }) => ranges.map((range) => ({ doctorId, weekday, ...range })));
}

async function insertSchedule(tx: Transaction, doctorId: string, days: ScheduleDay[]): Promise<void> {
  await tx.insert(doctorScheduleDays).values(dayRows(doctorId, days));
  const ranges = rangeRows(doctorId, days);
  if (ranges.length > 0) await tx.insert(doctorScheduleRanges).values(ranges);
}
