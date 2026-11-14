import type { RequestHandler } from 'express';
import { authOf } from '../../middleware/auth.js';
import { patientBookingsQuery } from './patient-bookings.model.js';
import type { PatientBookingsService } from './patient-bookings.service.js';

export function createPatientBookingsController(service: PatientBookingsService) {
  return {
    page: (async (req, res) => {
      res.json(await service.page(authOf(req).user.id, patientBookingsQuery.parse(req.query)));
    }) satisfies RequestHandler,
    home: (async (req, res) => {
      res.json(await service.home(authOf(req).user.id));
    }) satisfies RequestHandler,
  };
}

export type PatientBookingsController = ReturnType<typeof createPatientBookingsController>;
