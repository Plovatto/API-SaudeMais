import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { civilDate, DAY, MINUTE, wallClockIn } from '@/lib/time.js';
import { slotDays, type SlotRequest, type WeekdayRange } from '@/lib/time-slots.js';

const SAO_PAULO = 'America/Sao_Paulo';
const NEW_YORK = 'America/New_York';
const ORIGINAL_TZ = process.env.TZ;

const allDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, openMin: 0, closeMin: 1440 }));

function request(overrides: Partial<SlotRequest> = {}): SlotRequest {
  return {
    ranges: [{ weekday: 1, startMin: 480, endMin: 720 }],
    unitHours: [{ weekday: 1, openMin: 420, closeMin: 1140 }],
    durationMin: 30,
    minLeadMinutes: 60,
    bookingHorizonDays: 60,
    now: new Date('2026-11-20T12:00:00.000Z'),
    from: '2026-11-23',
    to: '2026-11-23',
    timeZone: SAO_PAULO,
    busy: [],
    ...overrides,
  };
}

const starts = (input: SlotRequest) => slotDays(input).flatMap((day) => day.slots.map((slot) => slot.startsAt));

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('slotDays', () => {
  it('steps through the range by the duration in São Paulo time', () => {
    const days = slotDays(request());

    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe('2026-11-23');
    expect(days[0]?.slots).toHaveLength(8);
    expect(days[0]?.slots[0]).toEqual({ startsAt: '2026-11-23T11:00:00.000Z', endsAt: '2026-11-23T11:30:00.000Z' });
    expect(days[0]?.slots.at(-1)).toEqual({ startsAt: '2026-11-23T14:30:00.000Z', endsAt: '2026-11-23T15:00:00.000Z' });
  });

  it('aligns to the range start and keeps only slots inside the unit hours', () => {
    const input = request({ ranges: [{ weekday: 1, startMin: 360, endMin: 600 }], durationMin: 40 });

    expect(starts(input)).toEqual([
      '2026-11-23T10:20:00.000Z',
      '2026-11-23T11:00:00.000Z',
      '2026-11-23T11:40:00.000Z',
      '2026-11-23T12:20:00.000Z',
    ]);
  });

  it('drops the last slot when it does not fit before the range or the unit closes', () => {
    const range = request({ ranges: [{ weekday: 1, startMin: 480, endMin: 590 }], durationMin: 50 });
    const closing = request({ unitHours: [{ weekday: 1, openMin: 420, closeMin: 570 }], durationMin: 50 });

    expect(starts(range)).toEqual(['2026-11-23T11:00:00.000Z', '2026-11-23T11:50:00.000Z']);
    expect(starts(closing)).toEqual(['2026-11-23T11:00:00.000Z']);
  });

  it('skips days without ranges and days the unit is closed', () => {
    const week = request({ from: '2026-11-22', to: '2026-11-28' });
    const closed = request({ unitHours: [{ weekday: 2, openMin: 0, closeMin: 1440 }] });

    expect(slotDays(week).map((day) => day.date)).toEqual(['2026-11-23']);
    expect(slotDays(closed)).toEqual([]);
  });

  it('respects the minimum lead time', () => {
    const input = request({ now: new Date('2026-11-23T11:10:00.000Z') });

    expect(starts(input)[0]).toBe('2026-11-23T12:30:00.000Z');
    expect(starts({ ...input, minLeadMinutes: 0 })[0]).toBe('2026-11-23T11:30:00.000Z');
  });

  it('stops at the booking horizon', () => {
    const input = request({
      now: new Date('2026-11-23T12:00:00.000Z'),
      bookingHorizonDays: 1,
      from: '2026-11-24',
      to: '2026-11-30',
      ranges: [1, 2, 3].map((weekday) => ({ weekday, startMin: 480, endMin: 720 })),
      unitHours: allDay,
    });

    expect(starts(input)).toEqual(['2026-11-24T11:00:00.000Z', '2026-11-24T11:30:00.000Z', '2026-11-24T12:00:00.000Z']);
  });

  it('hides every slot that overlaps a busy interval', () => {
    const busy = [{ startsAt: new Date('2026-11-23T11:15:00.000Z'), endsAt: new Date('2026-11-23T11:45:00.000Z') }];
    const touching = [{ startsAt: new Date('2026-11-23T12:00:00.000Z'), endsAt: new Date('2026-11-23T12:30:00.000Z') }];

    expect(starts(request({ busy })).slice(0, 2)).toEqual(['2026-11-23T12:00:00.000Z', '2026-11-23T12:30:00.000Z']);
    expect(starts(request({ busy: touching }))).not.toContain('2026-11-23T12:00:00.000Z');
    expect(starts(request({ busy: touching }))).toContain('2026-11-23T11:30:00.000Z');
    expect(starts(request({ busy: touching }))).toContain('2026-11-23T12:30:00.000Z');
  });

  it('keeps late evening slots on the São Paulo day even after midnight in UTC', () => {
    const input = request({
      ranges: [{ weekday: 1, startMin: 1320, endMin: 1440 }],
      unitHours: allDay,
    });

    expect(slotDays(input)).toEqual([
      {
        date: '2026-11-23',
        slots: [
          { startsAt: '2026-11-24T01:00:00.000Z', endsAt: '2026-11-24T01:30:00.000Z' },
          { startsAt: '2026-11-24T01:30:00.000Z', endsAt: '2026-11-24T02:00:00.000Z' },
          { startsAt: '2026-11-24T02:00:00.000Z', endsAt: '2026-11-24T02:30:00.000Z' },
          { startsAt: '2026-11-24T02:30:00.000Z', endsAt: '2026-11-24T03:00:00.000Z' },
        ],
      },
    ]);
  });

  it('uses the real offset of the zone on each day instead of a fixed one', () => {
    const base = {
      ranges: [0, 1].map((weekday) => ({ weekday, startMin: 0, endMin: 240 })),
      unitHours: allDay,
      durationMin: 60,
      minLeadMinutes: 0,
      now: new Date('2026-01-01T00:00:00.000Z'),
      bookingHorizonDays: 365,
      timeZone: NEW_YORK,
    };

    expect(starts(request({ ...base, from: '2026-03-02', to: '2026-03-02' }))[0]).toBe('2026-03-02T05:00:00.000Z');
    expect(starts(request({ ...base, from: '2026-07-06', to: '2026-07-06' }))[0]).toBe('2026-07-06T04:00:00.000Z');
  });

  it('skips slots that a daylight saving change would stretch, shrink or repeat', () => {
    const base = {
      ranges: [{ weekday: 0, startMin: 0, endMin: 300 }],
      unitHours: allDay,
      durationMin: 60,
      minLeadMinutes: 0,
      now: new Date('2026-01-01T00:00:00.000Z'),
      bookingHorizonDays: 365,
      timeZone: NEW_YORK,
    };

    expect(starts(request({ ...base, from: '2026-03-08', to: '2026-03-08' }))).toEqual([
      '2026-03-08T05:00:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T08:00:00.000Z',
    ]);
    expect(starts(request({ ...base, from: '2026-11-01', to: '2026-11-01' }))).toEqual([
      '2026-11-01T04:00:00.000Z',
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
    ]);
  });

  it('returns nothing for a window far beyond the horizon', () => {
    const input = request({
      from: '2099-01-01',
      to: '2099-01-31',
      ranges: allDay.map(({ weekday }) => ({ weekday, startMin: 0, endMin: 1440 })),
      unitHours: allDay,
      durationMin: 10,
    });

    expect(slotDays(input)).toEqual([]);
  });
});

const minuteStep = (min: number, max: number) => fc.integer({ min: min / 5, max: max / 5 }).map((step) => step * 5);

const dayRanges = (weekday: number) =>
  fc
    .uniqueArray(minuteStep(0, 1440), { minLength: 0, maxLength: 8 })
    .map((cuts) => cuts.sort((a, b) => a - b))
    .map((cuts) => {
      const ranges: WeekdayRange[] = [];
      for (let index = 0; index + 1 < cuts.length; index += 2) {
        ranges.push({ weekday, startMin: cuts[index] ?? 0, endMin: cuts[index + 1] ?? 0 });
      }
      return ranges;
    });

const openingHours = (weekday: number) =>
  fc
    .tuple(minuteStep(0, 1435), minuteStep(5, 1440))
    .filter(([open, close]) => open < close)
    .map(([openMin, closeMin]) => ({ weekday, openMin, closeMin }));

const requests = fc
  .record({
    ranges: fc.tuple(...[0, 1, 2, 3, 4, 5, 6].map(dayRanges)).map((days) => days.flat()),
    unitHours: fc
      .tuple(...[0, 1, 2, 3, 4, 5, 6].map((weekday) => fc.option(openingHours(weekday), { nil: undefined })))
      .map((hours) => hours.filter((entry) => entry !== undefined)),
    durationMin: minuteStep(10, 240),
    minLeadMinutes: fc.integer({ min: 0, max: 2880 }),
    bookingHorizonDays: fc.integer({ min: 1, max: 90 }),
    now: fc.date({
      min: new Date('2025-01-01T00:00:00.000Z'),
      max: new Date('2028-12-31T00:00:00.000Z'),
      noInvalidDate: true,
    }),
    fromOffset: fc.integer({ min: -3, max: 60 }),
    span: fc.integer({ min: 0, max: 30 }),
    timeZone: fc.constantFrom(SAO_PAULO, NEW_YORK),
    busy: fc.array(fc.tuple(fc.integer({ min: -2 * DAY, max: 40 * DAY }), fc.integer({ min: 1, max: 600 })), {
      maxLength: 10,
    }),
  })
  .map(({ fromOffset, span, busy, ...rest }): SlotRequest => {
    const fromDay = Date.parse(civilDate(rest.now.getTime())) + fromOffset * DAY;
    return {
      ...rest,
      from: civilDate(fromDay),
      to: civilDate(fromDay + span * DAY),
      busy: busy.map(([offset, minutes]) => {
        const startsAt = new Date(fromDay + offset);
        return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * MINUTE) };
      }),
    };
  });

describe('slotDays properties', () => {
  it('never returns overlapping slots and keeps them in order', () => {
    fc.assert(
      fc.property(requests, (input) => {
        const slots = slotDays(input).flatMap((day) => day.slots);
        slots.forEach((slot, index) => {
          const next = slots[index + 1];
          expect(Date.parse(slot.endsAt) - Date.parse(slot.startsAt)).toBe(input.durationMin * MINUTE);
          if (next) expect(Date.parse(next.startsAt)).toBeGreaterThanOrEqual(Date.parse(slot.endsAt));
        });
      }),
    );
  });

  it('keeps every slot inside a doctor range and the unit hours of its own day', () => {
    fc.assert(
      fc.property(requests, (input) => {
        for (const day of slotDays(input)) {
          expect(day.slots.length).toBeGreaterThan(0);
          expect(day.date >= input.from && day.date <= input.to).toBe(true);
          const weekday = new Date(Date.parse(day.date)).getUTCDay();
          const hours = input.unitHours.find((entry) => entry.weekday === weekday);
          for (const slot of day.slots) {
            const wallClock = wallClockIn(input.timeZone, new Date(slot.startsAt));
            const start = (wallClock - Date.parse(day.date)) / MINUTE;
            const end = start + input.durationMin;
            expect(civilDate(wallClock)).toBe(day.date);
            expect(hours && hours.openMin <= start && end <= hours.closeMin).toBe(true);
            const inRange = input.ranges.some(
              (range) =>
                range.weekday === weekday &&
                range.startMin <= start &&
                end <= range.endMin &&
                (start - range.startMin) % input.durationMin === 0,
            );
            expect(inRange).toBe(true);
          }
        }
      }),
    );
  });

  it('respects the lead time, the horizon and the busy intervals', () => {
    fc.assert(
      fc.property(requests, (input) => {
        const now = input.now.getTime();
        for (const slot of slotDays(input).flatMap((day) => day.slots)) {
          const startsAt = Date.parse(slot.startsAt);
          const endsAt = Date.parse(slot.endsAt);
          expect(startsAt).toBeGreaterThanOrEqual(now + input.minLeadMinutes * MINUTE);
          expect(startsAt).toBeLessThanOrEqual(now + input.bookingHorizonDays * DAY);
          for (const busy of input.busy) {
            expect(busy.startsAt.getTime() < endsAt && startsAt < busy.endsAt.getTime()).toBe(false);
          }
        }
      }),
    );
  });

  it('offers every free São Paulo slot that fits', () => {
    fc.assert(
      fc.property(requests, (input) => {
        const local = { ...input, timeZone: SAO_PAULO };
        const expected: string[] = [];
        for (let day = Date.parse(local.from); day <= Date.parse(local.to); day += DAY) {
          const weekday = new Date(day).getUTCDay();
          const hours = local.unitHours.find((entry) => entry.weekday === weekday);
          for (const range of local.ranges.filter((entry) => entry.weekday === weekday)) {
            for (let start = range.startMin; start + local.durationMin <= range.endMin; start += local.durationMin) {
              const startsAt = day + (start + 180) * MINUTE;
              const fits = hours && hours.openMin <= start && start + local.durationMin <= hours.closeMin;
              const open =
                startsAt >= local.now.getTime() + local.minLeadMinutes * MINUTE &&
                startsAt <= local.now.getTime() + local.bookingHorizonDays * DAY;
              const endsAt = startsAt + local.durationMin * MINUTE;
              const free = local.busy.every(
                (busy) => busy.startsAt.getTime() >= endsAt || startsAt >= busy.endsAt.getTime(),
              );
              if (fits && open && free) expected.push(new Date(startsAt).toISOString());
            }
          }
        }
        expect(starts(local).sort()).toEqual(expected.sort());
      }),
    );
  });

  it('gives the same answer whatever the time zone of the process', () => {
    fc.assert(
      fc.property(requests, (input) => {
        const answers = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'].map((zone) => {
          process.env.TZ = zone;
          return slotDays(input);
        });
        expect(answers[1]).toEqual(answers[0]);
        expect(answers[2]).toEqual(answers[0]);
      }),
      { numRuns: 50 },
    );
  });
});
