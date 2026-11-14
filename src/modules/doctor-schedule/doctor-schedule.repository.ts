import { asc, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import { unitHours, units } from '../../database/schema/catalog.js';
import { doctorProfiles } from '../../database/schema/doctor-profiles.js';
import { doctorScheduleDays, doctorScheduleRanges } from '../../database/schema/doctor-schedule.js';
import { recordAudit, type Actor } from '../../lib/audit.js';
import { WEEKDAYS } from '../../lib/week.js';
import type { Schedule, ScheduleDay, UnitHour } from './doctor-schedule.model.js';

export interface ReplaceRequest {
  doctorId: string;
  days: ScheduleDay[];
  actor: Actor;
  check: (hours: UnitHour[]) => void;
}

export class DoctorScheduleRepository {
  constructor(private readonly db: Database) {}

  find(doctorId: string): Promise<Schedule | undefined> {
    return this.db.transaction(
      async (tx) => {
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
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  replace({ doctorId, days, actor, check }: ReplaceRequest): Promise<UnitHour[] | undefined> {
    return this.db.transaction(async (tx) => {
      const unitId = await lockProfile(tx, doctorId);
      if (!unitId) return undefined;
      await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId)).for('share');
      const hours = await hoursOf(tx, unitId);
      check(hours);
      await tx.delete(doctorScheduleDays).where(eq(doctorScheduleDays.doctorId, doctorId));
      await insertSchedule(tx, doctorId, days);
      await recordAudit(tx, {
        ...actor,
        action: 'doctor_schedule.saved',
        entityType: 'doctor_profile',
        entityId: doctorId,
        metadata: {
          activeDays: days.filter((day) => day.isActive).map((day) => day.weekday),
          ranges: days.reduce((total, day) => total + day.ranges.length, 0),
        },
      });
      return hours;
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
}

async function lockProfile(tx: Transaction, doctorId: string): Promise<string | undefined> {
  const [profile] = await tx
    .select({ unitId: doctorProfiles.unitId })
    .from(doctorProfiles)
    .where(eq(doctorProfiles.userId, doctorId))
    .for('no key update');
  return profile?.unitId;
}

function hoursOf(tx: Transaction, unitId: string): Promise<UnitHour[]> {
  return tx
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
