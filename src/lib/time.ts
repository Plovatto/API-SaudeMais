export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const CLINIC_TIME_ZONE = 'America/Sao_Paulo';

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

function offsetMinutes(timeZone: string, date: Date): number {
  let format = offsetFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    offsetFormats.set(timeZone, format);
  }
  const name = format.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

export function wallClockIn(timeZone: string, instant: Date): number {
  return instant.getTime() + offsetMinutes(timeZone, instant) * MINUTE;
}

export function instantOfWallClock(timeZone: string, wallClock: number): Date {
  const guess = wallClock - offsetMinutes(timeZone, new Date(wallClock)) * MINUTE;
  return new Date(wallClock - offsetMinutes(timeZone, new Date(guess)) * MINUTE);
}

export function civilDate(wallClock: number): string {
  return new Date(wallClock).toISOString().slice(0, 10);
}

export function startOfDayIn(timeZone: string, date: Date): Date {
  const wallClock = wallClockIn(timeZone, date);
  return instantOfWallClock(timeZone, wallClock - (wallClock % DAY));
}

export interface DayRange {
  start: Date;
  end: Date;
}

export function dayRangeIn(timeZone: string, date: Date): DayRange {
  const start = startOfDayIn(timeZone, date);
  return { start, end: startOfDayIn(timeZone, new Date(start.getTime() + DAY + 2 * HOUR)) };
}

export function civilDayStartIn(timeZone: string, day: string, daysLater = 0): Date {
  return instantOfWallClock(timeZone, Date.parse(day) + daysLater * DAY);
}

export function civilPeriodIn(timeZone: string, { from, to }: { from: string; to: string }): DayRange {
  return { start: civilDayStartIn(timeZone, from), end: civilDayStartIn(timeZone, to, 1) };
}
