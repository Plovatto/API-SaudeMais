import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import { createDoctorsController } from './doctors.controller.js';
import { DoctorsRepository } from './doctors.repository.js';
import { createDoctorsRouter } from './doctors.routes.js';
import { DoctorsService } from './doctors.service.js';

export interface DoctorsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
}

export function createDoctorsModule({ db, clock, requireAuth }: DoctorsModuleDeps) {
  const service = new DoctorsService(new DoctorsRepository(db), clock);
  const router = createDoctorsRouter({
    controller: createDoctorsController(service),
    requireAuth,
    requirePatient: createRequireRole('patient'),
  });
  return { router, service };
}
