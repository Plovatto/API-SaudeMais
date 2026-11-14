import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { createDoctorAgendaController } from './doctor-agenda.controller.js';
import { DoctorAgendaRepository } from './doctor-agenda.repository.js';
import { createDoctorAgendaRouter } from './doctor-agenda.routes.js';
import { DoctorAgendaService } from './doctor-agenda.service.js';

export interface DoctorAgendaModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  notifications: NotificationsService;
}

export function createDoctorAgendaModule({ db, clock, requireAuth, notifications }: DoctorAgendaModuleDeps) {
  const service = new DoctorAgendaService(new DoctorAgendaRepository(db), notifications, clock);
  const router = createDoctorAgendaRouter({
    controller: createDoctorAgendaController(service),
    requireAuth,
    requireDoctor: createRequireRole('doctor'),
  });
  return { router };
}
