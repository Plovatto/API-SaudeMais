import { and, eq, gt, or, sql, type SQL } from 'drizzle-orm';
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
import { specialties, units } from '../../database/schema/catalog.js';

export type BookingSide = 'patient' | 'doctor';

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

export interface SeenBooking {
  id: string;
  startsAt: Date;
}

interface Change {
  set: PgUpdateSetSource<typeof bookings>;
  where: SQL | undefined;
  event: Pick<typeof bookingEvents.$inferInsert, 'eventType' | 'actorType' | 'actorUserId' | 'createdAt'>;
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

export async function hasActiveFuture(db: Pick<Database, '$count'>, scope: SQL, now: Date): Promise<boolean> {
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
