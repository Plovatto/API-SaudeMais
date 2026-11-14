import type { Clock } from '../../lib/clock.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { BookingsService } from './bookings.service.js';

export interface BookingsModuleDeps {
  clock: Clock;
  notifications: NotificationsService;
}

export function createBookingsModule({ clock, notifications }: BookingsModuleDeps) {
  return { service: new BookingsService(notifications, clock) };
}
