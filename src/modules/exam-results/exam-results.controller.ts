import type { RequestHandler } from 'express';
import { paginationQuery } from '../../lib/pagination.js';
import { actorOf } from '../../middleware/auth.js';
import { bookingParams, patientParams } from './exam-results.model.js';
import type { ExamResultsService } from './exam-results.service.js';

export function createExamResultsController(service: ExamResultsService) {
  return {
    patientResult: (async (req, res) => {
      res.json(await service.patientResult(bookingParams.parse(req.params).bookingId, actorOf(req)));
    }) satisfies RequestHandler,
    doctorResults: (async (req, res) => {
      const { patientId } = patientParams.parse(req.params);
      res.json(await service.doctorResults(patientId, paginationQuery.parse(req.query), actorOf(req)));
    }) satisfies RequestHandler,
  };
}

export type ExamResultsController = ReturnType<typeof createExamResultsController>;
