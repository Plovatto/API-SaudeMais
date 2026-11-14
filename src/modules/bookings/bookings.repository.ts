import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import {
  bookingEvents,
  bookings,
  isActiveFuture,
  isLateCancellation,
  type BookingStatus,
  type CancellerRole,
} from '../../database/schema/bookings.js';

export type BookingSide = 'patient' | 'doctor';

export interface Canceller {
  role: CancellerRole;
  userId: string | null;
  reason?: string | null;
}

export interface CancelledBooking {
  id: string;
  patientId: string;
  doctorId: string | null;
  startsAt: Date;
}

export interface SeenBooking {
  id: string;
  startsAt: Date;
}

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

const sideColumns = { patient: bookings.patientId, doctor: bookings.doctorId };

export function ofAccount(userId: string, sides: BookingSide[]): SQL {
  return or(...sides.map((side) => eq(sideColumns[side], userId))) ?? sql`false`;
}

export function asSeen({ id, startsAt }: SeenBooking): SQL {
  return sql`${eq(bookings.id, id)} and ${eq(bookings.startsAt, startsAt)}`;
}

export async function hasActiveFuture(db: Pick<Database, '$count'>, scope: SQL, now: Date): Promise<boolean> {
  return (await db.$count(bookings, and(isActiveFuture(now), scope))) > 0;
}

export async function futureBookingCounts(db: Pick<Database, 'select'>, userId: string, now: Date) {
  const [row] = await db
    .select({
      futureAppointmentsAsPatient: sql<number>`count(*) filter (where ${bookings.patientId} = ${userId})`.mapWith(
        Number,
      ),
      futureAppointmentsAsDoctor: sql<number>`count(*) filter (where ${bookings.doctorId} = ${userId})`.mapWith(Number),
    })
    .from(bookings)
    .where(and(isActiveFuture(now), ofAccount(userId, ['patient', 'doctor'])));
  return row ?? { futureAppointmentsAsPatient: 0, futureAppointmentsAsDoctor: 0 };
}

export async function cancelActiveFuture(
  tx: Transaction,
  scope: SQL,
  { role, userId, reason = null }: Canceller,
  now: Date,
): Promise<CancelledBooking[]> {
  const rows = await tx
    .update(bookings)
    .set({
      status: 'cancelled',
      cancelledByRole: role,
      cancelledBy: userId,
      cancelledAt: now,
      cancelReason: reason,
      lateCancellation: role === 'patient' ? isLateCancellation(now) : false,
    })
    .where(and(isActiveFuture(now), scope))
    .returning({
      id: bookings.id,
      patientId: bookings.patientId,
      doctorId: bookings.doctorId,
      startsAt: bookings.startsAt,
      fromStatus: sql<BookingStatus>`old.status`,
    });
  if (rows.length > 0) {
    await tx.insert(bookingEvents).values(
      rows.map((row) => ({
        bookingId: row.id,
        eventType: 'cancelled' as const,
        actorType: role,
        actorUserId: userId,
        fromStatus: row.fromStatus,
        toStatus: 'cancelled' as const,
        createdAt: now,
      })),
    );
  }
  return rows.map(({ fromStatus: _fromStatus, ...row }) => row);
}
