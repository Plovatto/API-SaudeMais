import type { RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { authOf } from '../../middleware/auth.js';
import { rescheduleSchema } from '../appointments/appointments.model.js';
import { bookExamSchema, cancelExamSchema, examAvailabilityQuery } from './exam-bookings.model.js';
import type { ExamBookingsService } from './exam-bookings.service.js';

export function createExamBookingsController(service: ExamBookingsService) {
  return {
    availability: (async (req, res) => {
      res.json(await service.availability(examAvailabilityQuery.parse(req.query)));
    }) satisfies RequestHandler,
    book: (async (req, res) => {
      res.status(201).json(await service.book(authOf(req).user.id, bookExamSchema.parse(req.body)));
    }) satisfies RequestHandler,
    detail: (async (req, res) => {
      res.json(await service.detail(idParams.parse(req.params).id, authOf(req).user.id));
    }) satisfies RequestHandler,
    cancel: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.cancel(id, authOf(req).user.id, cancelExamSchema.parse(req.body)));
    }) satisfies RequestHandler,
    reschedule: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.reschedule(id, authOf(req).user.id, rescheduleSchema.parse(req.body)));
    }) satisfies RequestHandler,
  };
}

export type ExamBookingsController = ReturnType<typeof createExamBookingsController>;
