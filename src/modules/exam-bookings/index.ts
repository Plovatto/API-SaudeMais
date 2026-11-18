import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import { createExamBookingsController } from './exam-bookings.controller.js';
import { ExamBookingsRepository } from './exam-bookings.repository.js';
import { createExamBookingsRouter } from './exam-bookings.routes.js';
import { ExamBookingsService } from './exam-bookings.service.js';

interface ExamBookingsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  bookings: BookingsService;
}

export function createExamBookingsModule({ db, clock, requireAuth, bookings }: ExamBookingsModuleDeps) {
  const service = new ExamBookingsService(new ExamBookingsRepository(db), bookings, clock);
  const router = createExamBookingsRouter({
    controller: createExamBookingsController(service),
    requireAuth,
    requirePatient: createRequireRole('patient'),
  });
  return { router };
}
