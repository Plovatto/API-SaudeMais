import { AppError } from '../../lib/app-error.js';
import type { Actor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import type { Page, Pagination } from '../../lib/pagination.js';
import { noExamReview, resultNotFound } from './exam-results.messages.js';
import type { ExamResult } from './exam-results.model.js';
import type { ExamResultsRepository } from './exam-results.repository.js';

export class ExamResultsService {
  constructor(
    private readonly repository: ExamResultsRepository,
    private readonly clock: Clock,
  ) {}

  async patientResult(bookingId: string, actor: Actor): Promise<ExamResult> {
    const result = await this.repository.patientResult(bookingId, actor);
    if (!result) throw new AppError(404, 'NOT_FOUND', resultNotFound);
    return result;
  }

  async doctorResults(patientId: string, pagination: Pagination, actor: Actor): Promise<Page<ExamResult>> {
    const page = await this.repository.doctorResults(patientId, pagination, actor, this.clock.now());
    if (!page) throw new AppError(403, noExamReview.code, noExamReview.message);
    return page;
  }
}
