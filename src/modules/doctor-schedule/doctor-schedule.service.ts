import { conflictError, notFound, unprocessable, unprocessableField, type FieldErrors } from '../../lib/app-error.js';
import type { Actor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { isExclusionViolation } from '../../lib/pg-errors.js';
import { civilDate, civilDateIn, CLINIC_TIME_ZONE, DAY } from '../../lib/time.js';
import { MAX_BOOKING_HORIZON_DAYS } from '../catalog/catalog.model.js';
import { isWorkday, WEEKDAYS } from '../../lib/week.js';
import { scheduleMessages } from './doctor-schedule.messages.js';
import type {
  CreatedTimeOff,
  CreateTimeOffInput,
  SaveScheduleInput,
  SavedSchedule,
  Schedule,
  ScheduleDay,
  TimeOff,
  UnitHour,
} from './doctor-schedule.model.js';
import type { DoctorScheduleRepository } from './doctor-schedule.repository.js';

const DEFAULT_RANGES = [
  { startMin: 8 * 60, endMin: 12 * 60 },
  { startMin: 13 * 60, endMin: 17 * 60 },
];

export const DEFAULT_SCHEDULE: ScheduleDay[] = WEEKDAYS.map((weekday) => {
  const isActive = isWorkday(weekday);
  return { weekday, isActive, ranges: isActive ? DEFAULT_RANGES : [] };
});

const rangeField = (dayIndex: number, rangeIndex: number) => `days.${dayIndex}.ranges.${rangeIndex}`;

const rejection = ({ code, message }: { code: string; message: string }, fields?: FieldErrors) =>
  unprocessable(code, message, fields);


const profileMissing = () => notFound(scheduleMessages.profileMissing);

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

const today = (now: Date) => civilDateIn(CLINIC_TIME_ZONE, now);

const lastBlockableDay = (now: Date) => civilDate(Date.parse(today(now)) + MAX_BOOKING_HORIZON_DAYS * DAY);

export class DoctorScheduleService {
  constructor(
    private readonly repository: DoctorScheduleRepository,
    private readonly clock: Clock,
  ) {}

  async schedule(doctorId: string): Promise<Schedule> {
    const schedule = await this.repository.find(doctorId);
    if (!schedule) throw profileMissing();
    return schedule;
  }

  async save(doctorId: string, input: SaveScheduleInput, actor: Actor): Promise<SavedSchedule> {
    const overlapping = overlaps(input.days);
    if (hasErrors(overlapping)) throw rejection(scheduleMessages.overlap, overlapping);
    const days = sortDays(input.days);
    let replaced: Awaited<ReturnType<DoctorScheduleRepository['replace']>>;
    try {
      replaced = await this.repository.replace({
        doctorId,
        days,
        appointmentDurationMin: input.appointmentDurationMin,
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
    if (!replaced) throw profileMissing();
    return { days, ...replaced, warnings: [] };
  }

  async timeOff(doctorId: string): Promise<TimeOff[]> {
    const entries = await this.repository.timeOff(doctorId, today(this.clock.now()));
    if (!entries) throw profileMissing();
    return entries;
  }

  async block(doctorId: string, { date, reason }: CreateTimeOffInput, actor: Actor): Promise<CreatedTimeOff> {
    const now = this.clock.now();
    if (date < today(now)) throw unprocessableField(scheduleMessages.pastDate);
    if (date > lastBlockableDay(now)) throw unprocessableField(scheduleMessages.tooFar);
    const result = await this.repository.block({ doctorId, date, reason: reason || null, actor, now });
    if (result === 'missing') throw profileMissing();
    if (result === 'exists') throw conflictError(scheduleMessages.timeOffExists);
    return result;
  }

  async unblock(doctorId: string, date: string, actor: Actor): Promise<void> {
    if (date < today(this.clock.now())) throw unprocessableField(scheduleMessages.pastDate);
    const result = await this.repository.unblock({ doctorId, date, actor });
    if (result === 'missing') throw profileMissing();
    if (result === 'absent') throw notFound(scheduleMessages.timeOffMissing);
  }

  ensureDefault(doctorId: string): Promise<void> {
    return this.repository.ensure(doctorId, DEFAULT_SCHEDULE);
  }
}
