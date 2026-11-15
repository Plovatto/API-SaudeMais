import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isLateCancellation, type BookingStatus } from '@/database/schema/bookings.js';
import { settings as settingsTable } from '@/database/schema/catalog.js';
import { bookingActions, doctorActions, type PolicySubject } from '@/modules/bookings/booking-policy.js';
import { createTestDb } from './support/create-test-db.js';
import { HOUR, START } from './support/users.js';

const settings = { appointmentLateWindowHours: 24, examLateWindowHours: 2, maxReschedules: 2 };

const subject = (
  kind: PolicySubject['kind'],
  status: BookingStatus,
  hoursAhead: number,
  rescheduleCount = 0,
): PolicySubject => ({ kind, status, startsAt: new Date(START.getTime() + hoursAhead * HOUR), rescheduleCount });

const open = { canCancel: true, lateCancellation: false, cancelBlockedReason: null };
const late = { canCancel: true, lateCancellation: true, cancelBlockedReason: null };
const reschedulable = (left: number) => ({ canReschedule: true, rescheduleBlockedReason: null, reschedulesLeft: left });
const blocked = (reason: string, left = 2) => ({
  canReschedule: false,
  rescheduleBlockedReason: reason,
  reschedulesLeft: left,
});
const closed = (reason: string, left = 2) => ({
  canCancel: false,
  lateCancellation: false,
  cancelBlockedReason: reason,
  ...blocked(reason, left),
});

const table: [string, PolicySubject, Record<string, unknown>][] = [
  ['pending appointment outside the window', subject('appointment', 'pending', 48), { ...open, ...reschedulable(2) }],
  ['pending appointment inside the window', subject('appointment', 'pending', 3), { ...open, ...reschedulable(2) }],
  [
    'confirmed appointment outside the window',
    subject('appointment', 'confirmed', 25),
    { ...open, ...reschedulable(2) },
  ],
  [
    'confirmed appointment exactly at the window boundary',
    subject('appointment', 'confirmed', 24),
    { ...open, ...reschedulable(2) },
  ],
  [
    'confirmed appointment inside the window',
    subject('appointment', 'confirmed', 23),
    { ...late, ...blocked('window_closed') },
  ],
  ['confirmed exam outside the exam window', subject('exam', 'confirmed', 3), { ...open, ...reschedulable(2) }],
  ['confirmed exam inside the exam window', subject('exam', 'confirmed', 1), { ...late, ...blocked('window_closed') }],
  ['appointment with one reschedule left', subject('appointment', 'pending', 48, 1), { ...open, ...reschedulable(1) }],
  [
    'appointment at the reschedule limit',
    subject('appointment', 'pending', 48, 2),
    { ...open, ...blocked('limit', 0) },
  ],
  ['exam at the reschedule limit', subject('exam', 'confirmed', 48, 2), { ...open, ...blocked('limit', 0) }],
  [
    'confirmed appointment inside the window at the limit',
    subject('appointment', 'confirmed', 1, 2),
    { ...late, ...blocked('window_closed', 0) },
  ],
  ['confirmed appointment that has started', subject('appointment', 'confirmed', -1), closed('started')],
  ['confirmed exam that has started', subject('exam', 'confirmed', 0), closed('started')],
  ['pending appointment whose time has come', subject('appointment', 'pending', -1), closed('closed')],
  ['expired appointment', subject('appointment', 'expired', -1), closed('closed')],
  ['cancelled future appointment', subject('appointment', 'cancelled', 48), closed('closed')],
  ['cancelled future exam', subject('exam', 'cancelled', 48, 1), closed('closed', 1)],
  ['completed appointment', subject('appointment', 'completed', -2), closed('closed')],
  ['no-show appointment', subject('appointment', 'no_show', -2), closed('closed')],
];

describe('booking policy', () => {
  it.each(table)('%s', (_name, booking, expected) => {
    expect(bookingActions(booking, settings, START)).toEqual(expected);
  });

  it('follows the windows and the limit from the settings', () => {
    const custom = { appointmentLateWindowHours: 0, examLateWindowHours: 48, maxReschedules: 0 };

    expect(bookingActions(subject('appointment', 'confirmed', 1), custom, START)).toMatchObject({
      lateCancellation: false,
      rescheduleBlockedReason: 'limit',
      reschedulesLeft: 0,
    });
    expect(bookingActions(subject('exam', 'confirmed', 47), custom, START)).toMatchObject({
      lateCancellation: true,
      rescheduleBlockedReason: 'window_closed',
    });
  });

  it.each([
    ['pending, not started', 'pending', 1, { canConfirm: true, canCancel: true, canComplete: false, canNoShow: false }],
    [
      'confirmed, not started',
      'confirmed',
      1,
      { canConfirm: false, canCancel: true, canComplete: false, canNoShow: false },
    ],
    [
      'confirmed, starting now',
      'confirmed',
      0,
      { canConfirm: false, canCancel: false, canComplete: true, canNoShow: true },
    ],
    [
      'confirmed, started',
      'confirmed',
      -1,
      { canConfirm: false, canCancel: false, canComplete: true, canNoShow: true },
    ],
    ['expired', 'expired', -1, { canConfirm: false, canCancel: false, canComplete: false, canNoShow: false }],
    ['completed', 'completed', -1, { canConfirm: false, canCancel: false, canComplete: false, canNoShow: false }],
    ['cancelled', 'cancelled', 1, { canConfirm: false, canCancel: false, canComplete: false, canNoShow: false }],
  ] as const)('gives the doctor the actions of a %s appointment', (_name, status, hoursAhead, expected) => {
    expect(doctorActions(subject('appointment', status, hoursAhead), START)).toEqual(expected);
  });

  it('agrees with the late cancellation the database records', async () => {
    const db = await createTestDb();
    const [stored] = await db.select().from(settingsTable);
    if (!stored) throw new Error('Settings row is missing');
    const lateInDatabase = async ({ kind, status, startsAt }: PolicySubject) => {
      const rows = await db.execute<{ late: boolean }>(sql`
        select ${isLateCancellation(START)} as late
        from (values (${kind}, ${status}, ${startsAt.toISOString()}::timestamptz)) as bookings (kind, status, starts_at)
      `);
      return rows.rows[0]?.late;
    };

    for (const [name, booking] of table) {
      const { lateCancellation } = bookingActions(booking, stored, START);
      expect(await lateInDatabase(booking), name).toBe(lateCancellation);
    }
  });
});
