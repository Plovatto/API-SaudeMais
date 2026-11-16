import { and, asc, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../database/pg-client.js';
import {
  bookingEvents,
  bookings,
  isActiveFuture,
  isLateCancellation,
  type BookingStatus,
  type CancellerRole,
} from '../../database/schema/bookings.js';
import { settings, specialties, units } from '../../database/schema/catalog.js';
import { users } from '../../database/schema/users.js';
import { HOUR } from '../../lib/time.js';
import { bookingActions, type BookingActions, type PolicySettings, type PolicySubject } from './booking-policy.js';

export type BookingSide = 'patient' | 'doctor';

export type Outcome = Extract<BookingStatus, 'completed' | 'no_show'>;

const AUTO_COMPLETE_AFTER_HOURS = 72;

export interface Canceller {
  role: CancellerRole;
  userId: string | null;
  reason?: string | null;
}

export interface ChangedBooking {
  id: string;
  patientId: string;
  doctorId: string | null;
  startsAt: Date;
}

export interface LockedPatient {
  isProtected: boolean;
}

interface CreatedBooking {
  bookingId: string;
  patientId: string;
  status: BookingStatus;
  now: Date;
}

export interface SeenBooking {
  id: string;
  startsAt: Date;
}

export interface Move {
  startsAt: Date;
  endsAt: Date;
  status?: BookingStatus;
  lane?: number;
}

interface Change {
  set: PgUpdateSetSource<typeof bookings>;
  where: SQL | undefined;
  event: Pick<
    typeof bookingEvents.$inferInsert,
    'eventType' | 'actorType' | 'actorUserId' | 'createdAt' | 'fromStartsAt' | 'toStartsAt'
  >;
}

export const placeColumns = {
  specialty: { id: specialties.id, name: specialties.name, council: specialties.council },
  unit: { id: units.id, name: units.name, address: units.address, phone: units.phone },
};

export const cancellationColumns = {
  byRole: bookings.cancelledByRole,
  reason: bookings.cancelReason,
  late: bookings.lateCancellation,
  cancelledAt: bookings.cancelledAt,
};

interface CancellationRow {
  byRole: CancellerRole | null;
  reason: string | null;
  late: boolean;
  cancelledAt: Date | null;
}

export function cancellationOf({ byRole, reason, late, cancelledAt }: CancellationRow) {
  return byRole && cancelledAt ? { byRole, reason, late, cancelledAt: cancelledAt.toISOString() } : null;
}

export function viewOf<T extends { startsAt: Date; endsAt: Date; cancellation: CancellationRow }>(row: T) {
  const { startsAt, endsAt, cancellation, ...rest } = row;
  return {
    ...rest,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    cancellation: cancellationOf(cancellation),
  };
}

export const countWhere = (where: SQL | undefined) => sql<number>`count(*) filter (where ${where})`.mapWith(Number);

const sideColumns = { patient: bookings.patientId, doctor: bookings.doctorId };

export function ofAccount(userId: string, sides: BookingSide[]): SQL {
  return or(...sides.map((side) => eq(sideColumns[side], userId))) ?? sql`false`;
}

export function seenBy(userId: string, side: BookingSide, { id, startsAt }: SeenBooking): SQL {
  return sql`${ofAccount(userId, [side])} and ${eq(bookings.id, id)} and ${eq(bookings.startsAt, startsAt)}`;
}

async function policySettings(db: Pick<Database, 'select'>): Promise<PolicySettings> {
  const [row] = await db
    .select({
      appointmentLateWindowHours: settings.appointmentLateWindowHours,
      examLateWindowHours: settings.examLateWindowHours,
      maxReschedules: settings.maxReschedules,
    })
    .from(settings);
  if (!row) throw new Error('Settings row is missing');
  return row;
}

export async function actionsAt(db: Pick<Database, 'select'>, now: Date) {
  const current = await policySettings(db);
  return (booking: PolicySubject) => bookingActions(booking, current, now);
}

export function splitActions<T extends Omit<PolicySubject, 'kind'>, A = BookingActions>(
  row: T,
  kind: PolicySubject['kind'],
  actionsOf: (booking: PolicySubject) => A,
) {
  const { rescheduleCount: _rescheduleCount, ...view } = row;
  return { view, actions: actionsOf({ ...row, kind }) };
}

export function exceptOwn(patientId: string, id: string | undefined): SQL | undefined {
  return id === undefined ? undefined : sql`not (${eq(bookings.id, id)} and ${eq(bookings.patientId, patientId)})`;
}

export async function hasActiveFuture(
  db: Pick<Database, '$count'>,
  scope: SQL | undefined,
  now: Date,
): Promise<boolean> {
  return (await db.$count(bookings, and(isActiveFuture(now), scope))) > 0;
}

export async function futureBookingCounts(db: Pick<Database, 'select'>, userId: string, now: Date) {
  const [row] = await db
    .select({
      futureAppointmentsAsPatient: countWhere(eq(bookings.patientId, userId)),
      futureAppointmentsAsDoctor: countWhere(eq(bookings.doctorId, userId)),
    })
    .from(bookings)
    .where(and(isActiveFuture(now), ofAccount(userId, ['patient', 'doctor'])));
  return row ?? { futureAppointmentsAsPatient: 0, futureAppointmentsAsDoctor: 0 };
}

export function asPatient<T>(
  db: Database,
  patientId: string,
  work: (tx: Transaction, patient: LockedPatient) => Promise<T>,
): Promise<T | undefined> {
  return db.transaction(async (tx) => {
    const [patient] = await tx
      .select({ isProtected: users.isProtected })
      .from(users)
      .where(and(eq(users.id, patientId), isNull(users.deactivatedAt)))
      .for('no key update');
    return patient ? work(tx, patient) : undefined;
  });
}

export function activeFutureCount(db: Pick<Database, '$count'>, patientId: string, now: Date): Promise<number> {
  return db.$count(bookings, and(eq(bookings.patientId, patientId), isActiveFuture(now)));
}

export async function recordCreated(tx: Transaction, { bookingId, patientId, status, now }: CreatedBooking) {
  await tx.insert(bookingEvents).values({
    bookingId,
    eventType: 'created',
    actorType: 'patient',
    actorUserId: patientId,
    toStatus: status,
    createdAt: now,
  });
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export async function eventsOf(db: Pick<Database, 'select'>, bookingId: string) {
  const events = await db
    .select({
      type: bookingEvents.eventType,
      actorType: bookingEvents.actorType,
      fromStatus: bookingEvents.fromStatus,
      toStatus: bookingEvents.toStatus,
      fromStartsAt: bookingEvents.fromStartsAt,
      toStartsAt: bookingEvents.toStartsAt,
      createdAt: bookingEvents.createdAt,
    })
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bookingId))
    .orderBy(asc(bookingEvents.createdAt), asc(bookingEvents.id));
  return events.map((event) => ({
    ...event,
    fromStartsAt: iso(event.fromStartsAt),
    toStartsAt: iso(event.toStartsAt),
    createdAt: event.createdAt.toISOString(),
  }));
}

async function change(tx: Transaction, { set, where, event }: Change): Promise<ChangedBooking[]> {
  const rows = await tx
    .update(bookings)
    .set(set)
    .where(where)
    .returning({
      id: bookings.id,
      patientId: bookings.patientId,
      doctorId: bookings.doctorId,
      startsAt: bookings.startsAt,
      fromStatus: sql<BookingStatus>`old.status`,
      toStatus: bookings.status,
    });
  if (rows.length > 0) {
    await tx
      .insert(bookingEvents)
      .values(rows.map(({ id, fromStatus, toStatus }) => ({ ...event, bookingId: id, fromStatus, toStatus })));
  }
  return rows.map(({ fromStatus: _fromStatus, toStatus: _toStatus, ...row }) => row);
}

export function cancelActiveFuture(
  tx: Transaction,
  scope: SQL,
  { role, userId, reason = null }: Canceller,
  now: Date,
): Promise<ChangedBooking[]> {
  return change(tx, {
    set: {
      status: 'cancelled',
      cancelledByRole: role,
      cancelledBy: userId,
      cancelledAt: now,
      cancelReason: reason,
      lateCancellation: role === 'patient' ? isLateCancellation(now) : false,
    },
    where: and(isActiveFuture(now), scope),
    event: { eventType: 'cancelled', actorType: role, actorUserId: userId, createdAt: now },
  });
}

export function confirmPending(tx: Transaction, scope: SQL, doctorId: string, now: Date): Promise<ChangedBooking[]> {
  return change(tx, {
    set: { status: 'confirmed' },
    where: and(eq(bookings.status, 'pending'), gt(bookings.startsAt, now), scope),
    event: { eventType: 'confirmed', actorType: 'doctor', actorUserId: doctorId, createdAt: now },
  });
}

export function recordStarted(
  tx: Transaction,
  scope: SQL,
  outcome: Outcome,
  doctorId: string,
  now: Date,
): Promise<ChangedBooking[]> {
  return change(tx, {
    set: { status: outcome },
    where: and(eq(bookings.status, 'confirmed'), lte(bookings.startsAt, now), scope),
    event: { eventType: outcome, actorType: 'doctor', actorUserId: doctorId, createdAt: now },
  });
}

export function expirePending(tx: Transaction, now: Date): Promise<ChangedBooking[]> {
  return change(tx, {
    set: { status: 'expired' },
    where: and(eq(bookings.status, 'pending'), lte(bookings.startsAt, now)),
    event: { eventType: 'expired', actorType: 'system', actorUserId: null, createdAt: now },
  });
}

function completeConfirmed(tx: Transaction, where: SQL | undefined, now: Date): Promise<ChangedBooking[]> {
  return change(tx, {
    set: { status: 'completed' },
    where: and(eq(bookings.status, 'confirmed'), where),
    event: { eventType: 'completed', actorType: 'system', actorUserId: null, createdAt: now },
  });
}

export function completeEndedExams(tx: Transaction, now: Date): Promise<ChangedBooking[]> {
  return completeConfirmed(
    tx,
    and(eq(bookings.kind, 'exam'), lte(bookings.startsAt, now), lte(bookings.endsAt, now)),
    now,
  );
}

export function completeStaleAppointments(tx: Transaction, now: Date): Promise<ChangedBooking[]> {
  const startedBefore = new Date(now.getTime() - AUTO_COMPLETE_AFTER_HOURS * HOUR);
  return completeConfirmed(tx, and(eq(bookings.kind, 'appointment'), lte(bookings.startsAt, startedBefore)), now);
}

export async function lockSeen(tx: Transaction, patientId: string, seen: SeenBooking) {
  const [row] = await tx
    .select({
      id: bookings.id,
      kind: bookings.kind,
      status: bookings.status,
      startsAt: bookings.startsAt,
      rescheduleCount: bookings.rescheduleCount,
      lane: bookings.lane,
    })
    .from(bookings)
    .where(seenBy(patientId, 'patient', seen))
    .for('no key update');
  return row;
}

export type LockedBooking = NonNullable<Awaited<ReturnType<typeof lockSeen>>>;

export async function moveBooking(
  tx: Transaction,
  booking: LockedBooking,
  move: Move,
  patientId: string,
  now: Date,
): Promise<ChangedBooking | undefined> {
  const [moved] = await change(tx, {
    set: { ...move, rescheduleCount: sql`${bookings.rescheduleCount} + 1` },
    where: eq(bookings.id, booking.id),
    event: {
      eventType: 'rescheduled',
      actorType: 'patient',
      actorUserId: patientId,
      createdAt: now,
      fromStartsAt: booking.startsAt,
      toStartsAt: move.startsAt,
    },
  });
  return moved;
}
