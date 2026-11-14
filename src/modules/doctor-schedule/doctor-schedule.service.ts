import { AppError, unprocessable, type FieldErrors } from '../../lib/app-error.js';
import type { Actor } from '../../lib/audit.js';
import { isExclusionViolation } from '../../lib/pg-errors.js';
import { WEEKDAYS, WORKDAYS } from '../../lib/week.js';
import { scheduleMessages } from './doctor-schedule.messages.js';
import type { SaveScheduleInput, SavedSchedule, Schedule, ScheduleDay, UnitHour } from './doctor-schedule.model.js';
import type { DoctorScheduleRepository } from './doctor-schedule.repository.js';

const DEFAULT_RANGES = [
  { startMin: 8 * 60, endMin: 12 * 60 },
  { startMin: 13 * 60, endMin: 17 * 60 },
];

export const DEFAULT_SCHEDULE: ScheduleDay[] = WEEKDAYS.map((weekday) => {
  const isActive = (WORKDAYS as readonly number[]).includes(weekday);
  return { weekday, isActive, ranges: isActive ? DEFAULT_RANGES : [] };
});

const rangeField = (dayIndex: number, rangeIndex: number) => `days.${dayIndex}.ranges.${rangeIndex}`;

const rejection = ({ code, message }: { code: string; message: string }, fields?: FieldErrors) =>
  unprocessable(code, message, fields);

const profileMissing = () => new AppError(404, 'NOT_FOUND', scheduleMessages.profileMissing);

function overlaps(days: ScheduleDay[]): FieldErrors {
  const fields: FieldErrors = {};
  days.forEach((day, dayIndex) => {
    let latestEnd = -1;
    day.ranges
      .map((range, index) => ({ ...range, index }))
      .sort((a, b) => a.startMin - b.startMin)
      .forEach((range) => {
        if (range.startMin < latestEnd) fields[rangeField(dayIndex, range.index)] = scheduleMessages.overlap.message;
        latestEnd = Math.max(latestEnd, range.endMin);
      });
  });
  return fields;
}

function outsideUnitHours(days: ScheduleDay[], hours: UnitHour[]): FieldErrors {
  const fields: FieldErrors = {};
  days.forEach((day, dayIndex) => {
    const open = hours.find((hour) => hour.weekday === day.weekday);
    day.ranges.forEach((range, rangeIndex) => {
      if (!open || range.startMin < open.openMin || range.endMin > open.closeMin) {
        fields[rangeField(dayIndex, rangeIndex)] = scheduleMessages.outsideUnitHours.message;
      }
    });
  });
  return fields;
}

const sortDays = (days: ScheduleDay[]): ScheduleDay[] =>
  days
    .map((day) => ({ ...day, ranges: day.ranges.toSorted((a, b) => a.startMin - b.startMin) }))
    .sort((a, b) => a.weekday - b.weekday);

const hasErrors = (fields: FieldErrors) => Object.keys(fields).length > 0;

export class DoctorScheduleService {
  constructor(private readonly repository: DoctorScheduleRepository) {}

  async schedule(doctorId: string): Promise<Schedule> {
    const schedule = await this.repository.find(doctorId);
    if (!schedule) throw profileMissing();
    return schedule;
  }

  async save(doctorId: string, input: SaveScheduleInput, actor: Actor): Promise<SavedSchedule> {
    const overlapping = overlaps(input.days);
    if (hasErrors(overlapping)) throw rejection(scheduleMessages.overlap, overlapping);
    const days = sortDays(input.days);
    let unitHours: UnitHour[] | undefined;
    try {
      unitHours = await this.repository.replace({
        doctorId,
        days,
        actor,
        check: (hours) => {
          const outside = outsideUnitHours(input.days, hours);
          if (hasErrors(outside)) throw rejection(scheduleMessages.outsideUnitHours, outside);
        },
      });
    } catch (error) {
      if (isExclusionViolation(error, 'doctor_schedule_ranges_no_overlap_excl')) {
        throw rejection(scheduleMessages.overlap);
      }
      throw error;
    }
    if (!unitHours) throw profileMissing();
    return { days, unitHours, warnings: [] };
  }

  ensureDefault(doctorId: string): Promise<void> {
    return this.repository.ensure(doctorId, DEFAULT_SCHEDULE);
  }
}
