import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { createPatientBookingsController } from './patient-bookings.controller.js';
import { PatientBookingsRepository } from './patient-bookings.repository.js';
import { createPatientBookingsRouter } from './patient-bookings.routes.js';
import { PatientBookingsService } from './patient-bookings.service.js';

export interface PatientBookingsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  notifications: NotificationsService;
}

export function createPatientBookingsModule({ db, clock, requireAuth, notifications }: PatientBookingsModuleDeps) {
  const service = new PatientBookingsService(new PatientBookingsRepository(db), notifications, clock);
  const router = createPatientBookingsRouter({
    controller: createPatientBookingsController(service),
    requireAuth,
    requirePatient: createRequireRole('patient'),
  });
  return { router };
}
