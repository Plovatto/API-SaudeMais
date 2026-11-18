import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import { createExamResultsController } from './exam-results.controller.js';
import { ExamResultsRepository } from './exam-results.repository.js';
import { createExamResultsRouter } from './exam-results.routes.js';
import { ExamResultsService } from './exam-results.service.js';

interface ExamResultsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
}

export function createExamResultsModule({ db, clock, requireAuth }: ExamResultsModuleDeps) {
  const router = createExamResultsRouter({
    controller: createExamResultsController(new ExamResultsService(new ExamResultsRepository(db), clock)),
    requireAuth,
    requirePatient: createRequireRole('patient'),
    requireDoctor: createRequireRole('doctor'),
  });
  return { router };
}
