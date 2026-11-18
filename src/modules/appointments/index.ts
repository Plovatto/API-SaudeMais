import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { createAppointmentsController } from './appointments.controller.js';
import { AppointmentsRepository } from './appointments.repository.js';
import { createAppointmentsRouter } from './appointments.routes.js';
import { AppointmentsService } from './appointments.service.js';

interface AppointmentsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  notifications: NotificationsService;
  bookings: BookingsService;
}

export function createAppointmentsModule({ db, clock, requireAuth, notifications, bookings }: AppointmentsModuleDeps) {
  const service = new AppointmentsService(new AppointmentsRepository(db), notifications, bookings, clock);
  const router = createAppointmentsRouter({
    controller: createAppointmentsController(service),
    requireAuth,
    requirePatient: createRequireRole('patient'),
    requireDoctor: createRequireRole('doctor'),
  });
  return { router, service };
}
