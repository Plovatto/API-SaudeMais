export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

function offsetMinutes(timeZone: string, date: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

export function startOfDayIn(timeZone: string, date: Date): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone }).format(date).split('-').map(Number);
  const utcMidnight = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const guess = utcMidnight - offsetMinutes(timeZone, new Date(utcMidnight)) * MINUTE;
  return new Date(utcMidnight - offsetMinutes(timeZone, new Date(guess)) * MINUTE);
}
