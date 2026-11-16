import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { idParams } from '../../lib/params.js';
import { authOf } from '../../middleware/auth.js';
import type { Outcome } from '../bookings/bookings.repository.js';
import {
  bookAppointmentSchema,
  cancelAppointmentSchema,
  completeAppointmentSchema,
  confirmAppointmentSchema,
  recordAppointmentSchema,
  rescheduleSchema,
  type CompleteAppointmentInput,
} from './appointments.model.js';
import type { Viewer } from './appointments.repository.js';
import type { AppointmentsService } from './appointments.service.js';

function viewerOf(req: Request): Viewer {
  const { user } = authOf(req);
  return { userId: user.id, roles: user.roles };
}

export function createAppointmentsController(service: AppointmentsService) {
  const record = (outcome: Outcome, schema: z.ZodType<CompleteAppointmentInput>) =>
    (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.record(id, authOf(req).user.id, outcome, schema.parse(req.body)));
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
    complete: record('completed', completeAppointmentSchema),
    noShow: record('no_show', recordAppointmentSchema),
    reschedule: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.reschedule(id, authOf(req).user.id, rescheduleSchema.parse(req.body)));
    }) satisfies RequestHandler,
  };
}

export type AppointmentsController = ReturnType<typeof createAppointmentsController>;
