import type { RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { authOf } from '../../middleware/auth.js';
import { bookAppointmentSchema } from './appointments.model.js';
import type { AppointmentsService } from './appointments.service.js';

export function createAppointmentsController(service: AppointmentsService) {
  return {
    book: (async (req, res) => {
      res.status(201).json(await service.book(authOf(req).user.id, bookAppointmentSchema.parse(req.body)));
    }) satisfies RequestHandler,
    detail: (async (req, res) => {
      const { user } = authOf(req);
      res.json(await service.detail(idParams.parse(req.params).id, { userId: user.id, roles: user.roles }));
    }) satisfies RequestHandler,
  };
}

export type AppointmentsController = ReturnType<typeof createAppointmentsController>;
