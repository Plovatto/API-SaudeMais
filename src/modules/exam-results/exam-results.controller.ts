import type { RequestHandler } from 'express';
import { paginationQuery } from '../../lib/pagination.js';
import { actorOf, authOf } from '../../middleware/auth.js';
import { bookingParams, patientParams } from './exam-results.model.js';
import type { ExamResultsService } from './exam-results.service.js';

export function createExamResultsController(service: ExamResultsService) {
  return {
    patientResults: (async (req, res) => {
      res.json(await service.patientResults(paginationQuery.parse(req.query), actorOf(req)));
    }) satisfies RequestHandler,
    patientResult: (async (req, res) => {
      res.json(await service.patientResult(bookingParams.parse(req.params).bookingId, actorOf(req)));
    }) satisfies RequestHandler,
    patientPdf: (async (req, res) => {
      const { bookingId } = bookingParams.parse(req.params);
      const { fileName, pdf } = await service.patientPdf(bookingId, actorOf(req), authOf(req).user.fullName);
      res.type('application/pdf').attachment(fileName).send(pdf);
    }) satisfies RequestHandler,
    doctorResults: (async (req, res) => {
      const { patientId } = patientParams.parse(req.params);
      res.json(await service.doctorResults(patientId, paginationQuery.parse(req.query), actorOf(req)));
    }) satisfies RequestHandler,
  };
}

export type ExamResultsController = ReturnType<typeof createExamResultsController>;
