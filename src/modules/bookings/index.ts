import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { BookingsService } from './bookings.service.js';

interface BookingsModuleDeps {
  db: Database;
  clock: Clock;
  notifications: NotificationsService;
}

export function createBookingsModule({ db, clock, notifications }: BookingsModuleDeps) {
  return { service: new BookingsService(db, notifications, clock) };
}
