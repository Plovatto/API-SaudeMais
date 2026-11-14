import type { RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { authOf } from '../../middleware/auth.js';
import { availabilityQuery, doctorsQuery } from './doctors.model.js';
import type { DoctorsService } from './doctors.service.js';

export function createDoctorsController(service: DoctorsService) {
  return {
    page: (async (req, res) => {
      res.json(await service.page(doctorsQuery.parse(req.query), authOf(req).isProtected));
    }) satisfies RequestHandler,
    availability: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.availability(id, availabilityQuery.parse(req.query), authOf(req).isProtected));
    }) satisfies RequestHandler,
  };
}

export type DoctorsController = ReturnType<typeof createDoctorsController>;
