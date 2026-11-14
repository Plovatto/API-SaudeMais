import type { AfterCommit, Transaction } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  cancelActiveFuture,
  ofAccount,
  type BookingSide,
  type CancelledBooking,
  type Canceller,
} from './bookings.repository.js';

function counterparts(booking: CancelledBooking, userId: string, canceller: Canceller) {
  const notice = {
    type: 'appointment_cancelled' as const,
    bookingId: booking.id,
    params: { startsAt: booking.startsAt.toISOString(), cancelledByRole: canceller.role },
  };
  return [
    ...(booking.patientId === userId
      ? []
      : [{ ...notice, userId: booking.patientId, audienceRole: 'patient' as const }]),
    ...(booking.doctorId === null || booking.doctorId === userId
      ? []
      : [{ ...notice, userId: booking.doctorId, audienceRole: 'doctor' as const }]),
  ];
}

export class BookingsService {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  async cancelForAccount(
    tx: Transaction,
    userId: string,
    sides: BookingSide[],
    canceller: Canceller,
  ): Promise<AfterCommit> {
    const cancelled = await cancelActiveFuture(tx, ofAccount(userId, sides), canceller, this.clock.now());
    return this.notifications.notify(
      tx,
      cancelled.flatMap((booking) => counterparts(booking, userId, canceller)),
    );
  }
}
