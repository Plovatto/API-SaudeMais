import { asc, eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditLogs,
  bookingEvents,
  bookings,
  notifications,
  passwordResetTokens,
  users,
  type BookingStatus,
} from '@/database/schema/index.js';
import { DEMO_BOOKINGS } from '@/modules/demo/demo.data.js';
import { newPublicCode } from '@/modules/exam-bookings/exam-bookings.code.js';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { doctorNamed, setupClinic, type Clinic } from './support/doctors.js';
import { offerOf } from './support/exams.js';
import { as, HOUR, registration, START } from './support/users.js';

const MINUTE = 60_000;
const DAY = 24 * HOUR;
const NOTHING_PURGED = { sessions: 0, resetTokens: 0, notifications: 0, auditLogs: 0 };

let context: Clinic;

beforeEach(async () => {
  context = await setupClinic();
}, 60_000);

const run = (restoreDemo = false) => context.modules.maintenance.run({ restoreDemo });
const later = (ms: number) => new Date(context.clock.now().getTime() + ms);

async function userId(email: string): Promise<string> {
  const [row] = await context.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`${email} does not exist`);
  return row.id;
}

async function appointment(patientId: string, status: BookingStatus, startsAt: Date): Promise<string> {
  const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
  const [row] = await context.db
    .insert(bookings)
    .values({
      kind: 'appointment',
      patientId,
      unitId: carlos.unit.id,
      doctorId: carlos.id,
      specialtyId: carlos.specialty.id,
      visitType: 'routine',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
      status,
    })
    .returning({ id: bookings.id });
  return row?.id ?? '';
}

async function exam(patientId: string, startsAt: Date): Promise<string> {
  const offer = await offerOf(context, 'Unidade Central', 'hemograma');
  const [row] = await context.db
    .insert(bookings)
    .values({
      kind: 'exam',
      patientId,
      ...offer,
      publicCode: newPublicCode(),
      lane: 1,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 10 * MINUTE),
      status: 'confirmed',
    })
    .returning({ id: bookings.id });
  return row?.id ?? '';
}

async function statusOf(id: string) {
  const [row] = await context.db.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, id));
  return row?.status;
}

const lastEvent = async (id: string) =>
  (
    await context.db
      .select({
        eventType: bookingEvents.eventType,
        actorType: bookingEvents.actorType,
        actorUserId: bookingEvents.actorUserId,
        fromStatus: bookingEvents.fromStatus,
        toStatus: bookingEvents.toStatus,
      })
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingId, id))
      .orderBy(asc(bookingEvents.createdAt))
  ).at(-1);

describe('maintenance', () => {
  it('expires pending requests once their time comes and notifies the patient once', async () => {
    const patientId = await userId(registration().email);
    const due = await appointment(patientId, 'pending', later(HOUR));
    const upcoming = await appointment(patientId, 'pending', later(2 * HOUR));
    const unread = async () =>
      (
        await request(context.app)
          .get('/api/notifications/unread-count')
          .query({ role: 'patient' })
          .set(as(context.patient))
          .expect(200)
      ).body as { count: number };
    expect(await unread()).toEqual({ count: 0 });

    context.clock.advance(HOUR - 1);
    expect(await run()).toMatchObject({ expired: 0 });
    context.clock.advance(1);
    expect(await run()).toMatchObject({ expired: 1 });
    expect(await run()).toMatchObject({ expired: 0 });

    expect([await statusOf(due), await statusOf(upcoming)]).toEqual(['expired', 'pending']);
    expect(await lastEvent(due)).toEqual({
      eventType: 'expired',
      actorType: 'system',
      actorUserId: null,
      fromStatus: 'pending',
      toStatus: 'expired',
    });
    const sent = await context.db
      .select({
        userId: notifications.userId,
        audienceRole: notifications.audienceRole,
        type: notifications.type,
        bookingId: notifications.bookingId,
        params: notifications.params,
      })
      .from(notifications);
    expect(sent).toEqual([
      {
        userId: patientId,
        audienceRole: 'patient',
        type: 'appointment_expired',
        bookingId: due,
        params: { startsAt: new Date(START.getTime() + HOUR).toISOString() },
      },
    ]);
    expect(await unread()).toEqual({ count: 1 });
  });

  it('completes confirmed exams once they end', async () => {
    const id = await exam(await userId(registration().email), later(HOUR));

    context.clock.advance(HOUR + 10 * MINUTE - 1);
    expect(await run()).toMatchObject({ examsCompleted: 0 });
    context.clock.advance(1);
    expect(await run()).toMatchObject({ examsCompleted: 1 });
    expect(await run()).toMatchObject({ examsCompleted: 0 });

    expect(await statusOf(id)).toBe('completed');
    expect(await lastEvent(id)).toMatchObject({ eventType: 'completed', actorType: 'system', actorUserId: null });
  });

  it('completes confirmed appointments 72 hours after they started without a record', async () => {
    const id = await appointment(await userId(registration().email), 'confirmed', later(HOUR));

    context.clock.advance(HOUR + 72 * HOUR - 1);
    expect(await run()).toMatchObject({ appointmentsCompleted: 0 });
    context.clock.advance(1);
    expect(await run()).toMatchObject({ appointmentsCompleted: 1 });
    expect(await run()).toMatchObject({ appointmentsCompleted: 0 });

    expect(await statusOf(id)).toBe('completed');
    expect(await lastEvent(id)).toEqual({
      eventType: 'completed',
      actorType: 'system',
      actorUserId: null,
      fromStatus: 'confirmed',
      toStatus: 'completed',
    });
  });

  it('purges expired sessions and old reset tokens, notifications and audit logs', async () => {
    const patientId = await userId(registration().email);
    context.clock.advance(12 * HOUR - 1);
    const token = (suffix: string, age: number) => {
      const createdAt = later(-age);
      return {
        userId: patientId,
        tokenHash: suffix.padStart(64, '0'),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + HOUR),
        revokedAt: createdAt,
      };
    };
    await context.db.insert(passwordResetTokens).values([token('1', 48 * HOUR + 1), token('2', 48 * HOUR)]);
    await context.db.insert(notifications).values(
      [90 * DAY + 1, 90 * DAY].map((age) => ({
        userId: patientId,
        audienceRole: 'admin' as const,
        type: 'user_registered' as const,
        createdAt: later(-age),
      })),
    );
    await context.db.insert(auditLogs).values(
      [180 * DAY + 1, 180 * DAY].map((age) => ({
        actorType: 'system' as const,
        action: 'test',
        createdAt: later(-age),
      })),
    );

    expect((await run()).purged).toEqual({ sessions: 0, resetTokens: 1, notifications: 1, auditLogs: 1 });
    context.clock.advance(1);
    expect((await run()).purged).toEqual({ sessions: 2, resetTokens: 1, notifications: 1, auditLogs: 1 });
    expect((await run()).purged).toEqual(NOTHING_PURGED);
  });

  it('restores the demo bookings once per São Paulo day and keeps everyone else’s', async () => {
    const demoPatient = await userId(DEMO_ACCOUNTS[0]?.email ?? '');
    const visitor = await appointment(await userId(registration().email), 'pending', later(2 * DAY));
    const demoVisit = await appointment(demoPatient, 'pending', later(3 * DAY));
    const demoBookings = async () =>
      (
        await context.db
          .select({ kind: bookings.kind, status: bookings.status })
          .from(bookings)
          .where(eq(bookings.patientId, demoPatient))
      )
        .map(({ kind, status }) => `${kind}:${status}`)
        .sort();

    expect((await run(true)).demoRestored).toEqual({ deleted: 1, created: DEMO_BOOKINGS.length });

    expect([await statusOf(visitor), await statusOf(demoVisit)]).toEqual(['pending', undefined]);
    expect(await demoBookings()).toEqual([
      'appointment:completed',
      'appointment:confirmed',
      'appointment:confirmed',
      'appointment:pending',
      'exam:completed',
      'exam:confirmed',
    ]);
    const timeline = await context.db
      .select({ eventType: bookingEvents.eventType })
      .from(bookingEvents)
      .innerJoin(bookings, eq(bookings.id, bookingEvents.bookingId))
      .where(eq(bookings.patientId, demoPatient));
    expect(timeline).toHaveLength(DEMO_BOOKINGS.reduce((total, seed) => total + seed.history.length, 0));
    expect((await run(true)).demoRestored).toBeNull();

    context.clock.advance(DAY);
    expect((await run(true)).demoRestored).toEqual({ deleted: DEMO_BOOKINGS.length, created: DEMO_BOOKINGS.length });
    expect(await statusOf(visitor)).toBe('pending');
    expect((await run(false)).demoRestored).toBeNull();
  });
});
