import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import { createRequireRole, createRequireWritable } from '../../middleware/auth.js';
import { createDoctorScheduleController } from './doctor-schedule.controller.js';
import { DoctorScheduleRepository } from './doctor-schedule.repository.js';
import { createDoctorScheduleRouter } from './doctor-schedule.routes.js';
import { DoctorScheduleService } from './doctor-schedule.service.js';

export interface DoctorScheduleModuleDeps {
  db: Database;
  requireAuth: RequestHandler;
}

export function createDoctorScheduleModule({ db, requireAuth }: DoctorScheduleModuleDeps) {
  const service = new DoctorScheduleService(new DoctorScheduleRepository(db));
  const router = createDoctorScheduleRouter({
    controller: createDoctorScheduleController(service),
    requireAuth,
    requireDoctor: createRequireRole('doctor'),
    requireWritable: createRequireWritable(),
  });
  return { router, service };
}
