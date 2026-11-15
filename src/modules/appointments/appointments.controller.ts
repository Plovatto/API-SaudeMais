import type { Request, RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { authOf } from '../../middleware/auth.js';
import type { Outcome } from '../bookings/bookings.repository.js';
import {
  bookAppointmentSchema,
  cancelAppointmentSchema,
  confirmAppointmentSchema,
  recordAppointmentSchema,
} from './appointments.model.js';
import type { Viewer } from './appointments.repository.js';
import type { AppointmentsService } from './appointments.service.js';

function viewerOf(req: Request): Viewer {
  const { user } = authOf(req);
  return { userId: user.id, roles: user.roles };
}

export function createAppointmentsController(service: AppointmentsService) {
  const record = (outcome: Outcome) =>
    (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.record(id, authOf(req).user.id, outcome, recordAppointmentSchema.parse(req.body)));
    }) satisfies RequestHandler;
  return {
    book: (async (req, res) => {
      res.status(201).json(await service.book(authOf(req).user.id, bookAppointmentSchema.parse(req.body)));
    }) satisfies RequestHandler,
    detail: (async (req, res) => {
      res.json(await service.detail(idParams.parse(req.params).id, viewerOf(req)));
    }) satisfies RequestHandler,
    confirm: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.confirm(id, authOf(req).user.id, confirmAppointmentSchema.parse(req.body)));
    }) satisfies RequestHandler,
    cancel: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.cancel(id, viewerOf(req), cancelAppointmentSchema.parse(req.body)));
    }) satisfies RequestHandler,
    complete: record('completed'),
    noShow: record('no_show'),
  };
}

export type AppointmentsController = ReturnType<typeof createAppointmentsController>;
