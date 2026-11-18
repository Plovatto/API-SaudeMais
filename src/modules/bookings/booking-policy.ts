import type { BookingKind, BookingStatus } from '../../database/schema/bookings.js';
import { HOUR } from '../../lib/time.js';

export const cancelBlockedReasons = ['started', 'closed'] as const;
export const rescheduleBlockedReasons = ['window_closed', 'limit', ...cancelBlockedReasons] as const;

export interface PolicySettings {
  appointmentLateWindowHours: number;
  examLateWindowHours: number;
  maxReschedules: number;
}

export interface PolicySubject {
  kind: BookingKind;
  status: BookingStatus;
  startsAt: Date;
  rescheduleCount: number;
}

export interface BookingActions {
  canCancel: boolean;
  lateCancellation: boolean;
  cancelBlockedReason: (typeof cancelBlockedReasons)[number] | null;
  canReschedule: boolean;
  rescheduleBlockedReason: (typeof rescheduleBlockedReasons)[number] | null;
  reschedulesLeft: number;
}

export interface DoctorActions {
  canConfirm: boolean;
  canCancel: boolean;
  canComplete: boolean;
  canNoShow: boolean;
}

type Timing = Pick<PolicySubject, 'status' | 'startsAt'>;

const isActive = ({ status, startsAt }: Timing, now: Date) =>
  (status === 'pending' || status === 'confirmed') && startsAt > now;

export function doctorActions(booking: Timing, now: Date): DoctorActions {
  const active = isActive(booking, now);
  const awaitingRecord = booking.status === 'confirmed' && !active;
  return {
    canConfirm: active && booking.status === 'pending',
    canCancel: active,
    canComplete: awaitingRecord,
    canNoShow: awaitingRecord,
  };
}

export function bookingActions(booking: PolicySubject, settings: PolicySettings, now: Date): BookingActions {
  const { kind, status, startsAt, rescheduleCount } = booking;
  const active = isActive(booking, now);
  const windowHours = kind === 'exam' ? settings.examLateWindowHours : settings.appointmentLateWindowHours;
  const late = active && status === 'confirmed' && startsAt.getTime() - windowHours * HOUR < now.getTime();
  const reschedulesLeft = Math.max(0, settings.maxReschedules - rescheduleCount);
  const cancelBlockedReason = active ? null : status === 'confirmed' ? 'started' : 'closed';
  const rescheduleBlockedReason =
    cancelBlockedReason ?? (late ? 'window_closed' : reschedulesLeft === 0 ? 'limit' : null);
  return {
    canCancel: active,
    lateCancellation: late,
    cancelBlockedReason,
    canReschedule: rescheduleBlockedReason === null,
    rescheduleBlockedReason,
    reschedulesLeft,
  };
}
