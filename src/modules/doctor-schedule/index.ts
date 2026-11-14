import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole, createRequireWritable } from '../../middleware/auth.js';
import { createDoctorScheduleController } from './doctor-schedule.controller.js';
import { DoctorScheduleRepository } from './doctor-schedule.repository.js';
import { createDoctorScheduleRouter } from './doctor-schedule.routes.js';
import { DoctorScheduleService } from './doctor-schedule.service.js';

export interface DoctorScheduleModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
}

export function createDoctorScheduleModule({ db, clock, requireAuth }: DoctorScheduleModuleDeps) {
  const service = new DoctorScheduleService(new DoctorScheduleRepository(db), clock);
  const router = createDoctorScheduleRouter({
    controller: createDoctorScheduleController(service),
    requireAuth,
    requireDoctor: createRequireRole('doctor'),
    requireWritable: createRequireWritable(),
  });
  return { router, service };
}
