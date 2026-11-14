import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { createAppointmentsController } from './appointments.controller.js';
import { AppointmentsRepository } from './appointments.repository.js';
import { createAppointmentsRouter } from './appointments.routes.js';
import { AppointmentsService } from './appointments.service.js';

export interface AppointmentsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  notifications: NotificationsService;
}

export function createAppointmentsModule({ db, clock, requireAuth, notifications }: AppointmentsModuleDeps) {
  const service = new AppointmentsService(new AppointmentsRepository(db), notifications, clock);
  const router = createAppointmentsRouter({
    controller: createAppointmentsController(service),
    requireAuth,
    requirePatient: createRequireRole('patient'),
  });
  return { router, service };
}
