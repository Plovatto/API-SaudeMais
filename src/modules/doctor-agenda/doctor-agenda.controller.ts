import type { RequestHandler } from 'express';
import { authOf } from '../../middleware/auth.js';
import { doctorAppointmentsQuery } from './doctor-agenda.model.js';
import type { DoctorAgendaService } from './doctor-agenda.service.js';

export function createDoctorAgendaController(service: DoctorAgendaService) {
  return {
    page: (async (req, res) => {
      res.json(await service.page(authOf(req).user.id, doctorAppointmentsQuery.parse(req.query)));
    }) satisfies RequestHandler,
    home: (async (req, res) => {
      res.json(await service.home(authOf(req).user.id));
    }) satisfies RequestHandler,
  };
}

export type DoctorAgendaController = ReturnType<typeof createDoctorAgendaController>;
