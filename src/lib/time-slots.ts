import { civilDate, DAY, instantOfWallClock, MINUTE, wallClockIn } from './time.js';

export interface WeekdayRange {
  weekday: number;
  startMin: number;
  endMin: number;
}

export interface OpeningHours {
  weekday: number;
  openMin: number;
  closeMin: number;
}

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

export interface SlotDay {
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

export function slotDays(request: SlotRequest): SlotDay[] {
  const { durationMin, now, timeZone, busy } = request;
  const earliest = now.getTime() + request.minLeadMinutes * MINUTE;
  const latest = now.getTime() + request.bookingHorizonDays * DAY;
  const ranges = request.ranges.toSorted((a, b) => a.startMin - b.startMin);
  const days: SlotDay[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (let day = Date.parse(request.from); day <= Date.parse(request.to); day += DAY) {
    const weekday = new Date(day).getUTCDay();
    const hours = request.unitHours.find((entry) => entry.weekday === weekday);
    if (!hours) continue;
    const slots: Slot[] = [];
    for (const range of ranges.filter((entry) => entry.weekday === weekday)) {
      const end = Math.min(range.endMin, hours.closeMin);
      for (let start = range.startMin; start + durationMin <= end; start += durationMin) {
        if (start < hours.openMin) continue;
        const startWall = day + start * MINUTE;
        const endWall = startWall + durationMin * MINUTE;
        const startsAt = instantOfWallClock(timeZone, startWall);
        const endsAt = instantOfWallClock(timeZone, endWall);
        const exact =
          wallClockIn(timeZone, startsAt) === startWall &&
          wallClockIn(timeZone, endsAt) === endWall &&
          endsAt.getTime() - startsAt.getTime() === durationMin * MINUTE;
        const open = startsAt.getTime() >= Math.max(earliest, previousEnd) && startsAt.getTime() <= latest;
        const free = !busy.some((interval) => interval.startsAt < endsAt && startsAt < interval.endsAt);
        if (!exact || !open || !free) continue;
        slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
        previousEnd = endsAt.getTime();
      }
    }
    if (slots.length > 0) days.push({ date: civilDate(day), slots });
  }
  return days;
}
