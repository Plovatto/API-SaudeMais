import { civilDate, DAY, HOUR, instantOfWallClock, MINUTE, wallClockIn } from './time.js';

export interface WeekdayRange {
  weekday: number;
  startMin: number;
  endMin: number;
}

interface OpeningHours {
  weekday: number;
  openMin: number;
  closeMin: number;
}

interface Interval {
  startsAt: Date;
  endsAt: Date;
}

interface Slot {
  startsAt: string;
  endsAt: string;
}

interface SlotDay {
  date: string;
  slots: Slot[];
}

export interface SlotRequest {
  ranges: WeekdayRange[];
  unitHours: OpeningHours[];
  durationMin: number;
  minLeadMinutes: number;
  bookingHorizonDays: number;
  now: Date;
  from: string;
  to: string;
  timeZone: string;
  busy: Interval[];
}

const OFFSET_SLACK = 14 * HOUR;

function steadyOffset(timeZone: string, day: number): number | undefined {
  const before = new Date(day - OFFSET_SLACK);
  const after = new Date(day + DAY + OFFSET_SLACK);
  const offset = wallClockIn(timeZone, before) - before.getTime();
  return wallClockIn(timeZone, after) - after.getTime() === offset ? offset : undefined;
}

function keepsWallClock(timeZone: string, startWall: number, startsAt: number, duration: number): boolean {
  return (
    wallClockIn(timeZone, new Date(startsAt)) === startWall &&
    wallClockIn(timeZone, new Date(startsAt + duration)) === startWall + duration
  );
}

export function slotDays(request: SlotRequest): SlotDay[] {
  const { durationMin, timeZone, busy } = request;
  const duration = durationMin * MINUTE;
  const earliest = request.now.getTime() + request.minLeadMinutes * MINUTE;
  const latest = request.now.getTime() + request.bookingHorizonDays * DAY;
  const ranges = request.ranges.toSorted((a, b) => a.startMin - b.startMin);
  const days: SlotDay[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (let day = Date.parse(request.from); day <= Date.parse(request.to); day += DAY) {
    if (day - OFFSET_SLACK > latest) break;
    if (day + DAY + OFFSET_SLACK < earliest) continue;
    const weekday = new Date(day).getUTCDay();
    const hours = request.unitHours.find((entry) => entry.weekday === weekday);
    if (!hours) continue;
    const offset = steadyOffset(timeZone, day);
    const slots: Slot[] = [];
    for (const range of ranges.filter((entry) => entry.weekday === weekday)) {
      const end = Math.min(range.endMin, hours.closeMin);
      const skipped = Math.max(0, Math.ceil((hours.openMin - range.startMin) / durationMin));
      for (let start = range.startMin + skipped * durationMin; start + durationMin <= end; start += durationMin) {
        const startWall = day + start * MINUTE;
        const startsAt = offset === undefined ? instantOfWallClock(timeZone, startWall).getTime() : startWall - offset;
        const endsAt = startsAt + duration;
        if (startsAt < Math.max(earliest, previousEnd) || startsAt > latest) continue;
        const taken = busy.some(
          (interval) => interval.startsAt.getTime() < endsAt && startsAt < interval.endsAt.getTime(),
        );
        if (taken) continue;
        if (offset === undefined && !keepsWallClock(timeZone, startWall, startsAt, duration)) continue;
        slots.push({ startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() });
        previousEnd = endsAt;
      }
    }
    if (slots.length > 0) days.push({ date: civilDate(day), slots });
  }
  return days;
}
