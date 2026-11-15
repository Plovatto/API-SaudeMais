import type { SQL } from 'drizzle-orm';
import { runAfterCommit, type AfterCommit, type Database, type Transaction } from '../../database/pg-client.js';
import { conflictError, unprocessableField, type FieldConflict } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import { retryOnDeadlock } from '../../lib/pg-errors.js';
import { unauthenticated } from '../../middleware/auth.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { ACTIVE_LIMIT, activeLimit } from './bookings.messages.js';
import {
  activeFutureCount,
  asPatient,
  cancelActiveFuture,
  confirmPending,
  ofAccount,
  seenBy,
  type BookingSide,
  type ChangedBooking,
  type Canceller,
  type LockedPatient,
  type SeenBooking,
} from './bookings.repository.js';

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

  async ensureActiveLimit(tx: Transaction, patientId: string, { isProtected }: LockedPatient): Promise<void> {
    if (!isProtected && (await activeFutureCount(tx, patientId, this.clock.now())) >= ACTIVE_LIMIT) {
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

  private async cancel(tx: Transaction, scope: SQL, userId: string, canceller: Canceller) {
    const cancelled = await cancelActiveFuture(tx, scope, canceller, this.clock.now());
    const afterCommit = await this.notifications.notify(
      tx,
      cancelled.flatMap((booking) => counterparts(booking, userId, canceller)),
    );
    return { cancelled: cancelled.length, afterCommit };
  }
}
