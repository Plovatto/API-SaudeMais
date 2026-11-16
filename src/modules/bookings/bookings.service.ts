import { and, eq, type SQL } from 'drizzle-orm';
import { runAfterCommit, type AfterCommit, type Database, type Transaction } from '../../database/pg-client.js';
import { bookings } from '../../database/schema/bookings.js';
import { AppError, conflictError, unprocessableField, type FieldConflict } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { retryOnDeadlock } from '../../lib/pg-errors.js';
import { unauthenticated } from '../../middleware/auth.js';
import type { Delivery, NotificationsService } from '../notifications/notifications.service.js';
import type { BookingActions } from './booking-policy.js';
import { ACTIVE_LIMIT, activeLimit, notStarted, rescheduleConflicts, sameSlot } from './bookings.messages.js';
import {
  actionsAt,
  activeFutureCount,
  asPatient,
  cancelActiveFuture,
  completeEndedExams,
  completeStaleAppointments,
  confirmPending,
  expirePending,
  hasActiveFuture,
  lockSeen,
  moveBooking,
  ofAccount,
  recordStarted,
  seenBy,
  type BookingSide,
  type ChangedBooking,
  type Canceller,
  type LockedBooking,
  type LockedPatient,
  type Outcome,
  type Move,
  type SeenBooking,
} from './bookings.repository.js';

type Placement = Omit<Move, 'startsAt'>;

type SystemUpdate = (tx: Transaction, now: Date) => Promise<ChangedBooking[]>;

interface Reschedule extends SeenBooking {
  patientId: string;
  newStartsAt: Date;
  now: Date;
}

const rescheduleBlocks: Partial<Record<NonNullable<BookingActions['rescheduleBlockedReason']>, FieldConflict>> = {
  window_closed: rescheduleConflicts.windowClosed,
  limit: rescheduleConflicts.limit,
};

const nothingAfterCommit: AfterCommit = () => undefined;

function onNewStartsAt(error: unknown): unknown {
  if (!(error instanceof AppError) || error.fields?.startsAt === undefined) return error;
  const { startsAt, ...fields } = error.fields;
  return new AppError(error.status, error.code, error.message, { ...fields, newStartsAt: startsAt });
}

function counterparts(booking: ChangedBooking, userId: string, canceller: Canceller) {
  const notice = {
    bookingId: booking.id,
    params: { startsAt: booking.startsAt.toISOString(), cancelledByRole: canceller.role },
  };
  return [
    ...(booking.patientId === userId
      ? []
      : [
          {
            ...notice,
            type: 'appointment_cancelled' as const,
            userId: booking.patientId,
            audienceRole: 'patient' as const,
          },
        ]),
    ...(booking.doctorId === null || booking.doctorId === userId
      ? []
      : [
          {
            ...notice,
            type:
              canceller.role === 'patient'
                ? ('appointment_cancelled_by_patient' as const)
                : ('appointment_cancelled' as const),
            userId: booking.doctorId,
            audienceRole: 'doctor' as const,
          },
        ]),
  ];
}

export class BookingsService {
  constructor(
    private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  async writeAsPatient<T>(
    patientId: string,
    conflicts: Record<string, FieldConflict>,
    work: (tx: Transaction, patient: LockedPatient) => Promise<T>,
  ): Promise<T> {
    const result = await withConstraintConflicts(
      () => retryOnDeadlock(() => asPatient(this.db, patientId, work)),
      conflicts,
    );
    if (result === undefined) throw unauthenticated();
    return result;
  }

  async rescheduleAsPatient<T>(
    patientId: string,
    conflicts: Record<string, FieldConflict>,
    work: (tx: Transaction, patient: LockedPatient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.writeAsPatient(patientId, conflicts, work);
    } catch (error) {
      throw onNewStartsAt(error);
    }
  }

  async moveSeen(
    tx: Transaction,
    { patientId, newStartsAt, now, ...seen }: Reschedule,
    invalidState: FieldConflict,
    place: (booking: LockedBooking) => Placement | Promise<Placement>,
  ): Promise<ChangedBooking & { fromStartsAt: Date }> {
    const booking = await lockSeen(tx, patientId, seen);
    if (!booking) throw conflictError(invalidState);
    const { rescheduleBlockedReason } = (await actionsAt(tx, now))(booking);
    if (rescheduleBlockedReason) throw conflictError(rescheduleBlocks[rescheduleBlockedReason] ?? invalidState);
    if (newStartsAt.getTime() === booking.startsAt.getTime()) throw unprocessableField(sameSlot);
    const moved = await moveBooking(tx, booking, { ...(await place(booking)), startsAt: newStartsAt }, patientId, now);
    if (!moved) throw conflictError(invalidState);
    return { ...moved, fromStartsAt: booking.startsAt };
  }

  async ensureActiveLimit(tx: Transaction, patientId: string, { isProtected }: LockedPatient, now: Date) {
    if (!isProtected && (await activeFutureCount(tx, patientId, now)) >= ACTIVE_LIMIT) {
      throw unprocessableField(activeLimit);
    }
  }

  async commitSeen(
    work: (tx: Transaction) => Promise<AfterCommit | undefined>,
    conflict: FieldConflict,
  ): Promise<void> {
    const afterCommit = await retryOnDeadlock(() => this.db.transaction(work));
    if (!afterCommit) throw conflictError(conflict);
    runAfterCommit(afterCommit);
  }

  async cancelForAccount(
    tx: Transaction,
    userId: string,
    sides: BookingSide[],
    canceller: Canceller,
  ): Promise<AfterCommit> {
    return (await this.cancel(tx, ofAccount(userId, sides), userId, canceller)).afterCommit;
  }

  async cancelSeen(
    tx: Transaction,
    seen: SeenBooking,
    canceller: Canceller & { role: BookingSide; userId: string },
  ): Promise<AfterCommit | undefined> {
    const { userId, role } = canceller;
    const { cancelled, afterCommit } = await this.cancel(tx, seenBy(userId, role, seen), userId, canceller);
    return cancelled > 0 ? afterCommit : undefined;
  }

  async confirmSeen(tx: Transaction, seen: SeenBooking, doctorId: string): Promise<AfterCommit | undefined> {
    const confirmed = await confirmPending(tx, seenBy(doctorId, 'doctor', seen), doctorId, this.clock.now());
    if (confirmed.length === 0) return undefined;
    return this.notifications.notify(
      tx,
      confirmed.map((booking) => ({
        userId: booking.patientId,
        audienceRole: 'patient' as const,
        type: 'appointment_confirmed' as const,
        bookingId: booking.id,
        params: { startsAt: booking.startsAt.toISOString() },
      })),
    );
  }

  async recordSeen(
    tx: Transaction,
    seen: SeenBooking,
    doctorId: string,
    outcome: Outcome,
  ): Promise<AfterCommit | undefined> {
    const now = this.clock.now();
    const scope = seenBy(doctorId, 'doctor', seen);
    if ((await recordStarted(tx, scope, outcome, doctorId, now)).length > 0) return nothingAfterCommit;
    if (await hasActiveFuture(tx, and(eq(bookings.status, 'confirmed'), scope), now)) throw conflictError(notStarted);
    return undefined;
  }

  expireOverdue(): Promise<number> {
    return this.updateAsSystem(expirePending, (booking) => ({
      userId: booking.patientId,
      audienceRole: 'patient',
      type: 'appointment_expired',
      bookingId: booking.id,
      params: { startsAt: booking.startsAt.toISOString() },
    }));
  }

  completeEndedExams(): Promise<number> {
    return this.updateAsSystem(completeEndedExams);
  }

  completeStaleAppointments(): Promise<number> {
    return this.updateAsSystem(completeStaleAppointments);
  }

  private async updateAsSystem(update: SystemUpdate, notice?: (booking: ChangedBooking) => Delivery): Promise<number> {
    const now = this.clock.now();
    const { changed, afterCommit } = await retryOnDeadlock(() =>
      this.db.transaction(async (tx) => {
        const rows = await update(tx, now);
        return {
          changed: rows.length,
          afterCommit: await this.notifications.notify(tx, notice ? rows.map(notice) : []),
        };
      }),
    );
    runAfterCommit(afterCommit);
    return changed;
  }

  private async cancel(tx: Transaction, scope: SQL, userId: string, canceller: Canceller) {
    const cancelled = await cancelActiveFuture(tx, scope, canceller, this.clock.now());
    const afterCommit = await this.notifications.notify(
      tx,
      cancelled.flatMap((booking) => counterparts(booking, userId, canceller)),
    );
    return { cancelled: cancelled.length, afterCommit };
  }
}
