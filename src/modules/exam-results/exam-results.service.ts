import { AppError } from '../../lib/app-error.js';
import type { Actor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import type { Page, Pagination } from '../../lib/pagination.js';
import { noExamReview, resultNotFound } from './exam-results.messages.js';
import type { ExamResult, ExamResultSummary } from './exam-results.model.js';
import { renderResultPdf, resultFileName } from './exam-results.pdf.js';
import type { ExamResultsRepository } from './exam-results.repository.js';

function summaryOf({ booking, current }: ExamResult): ExamResultSummary {
  const flagged = current.items?.filter((item) => item.flag !== 'normal').map((item) => item.name);
  return {
    bookingId: booking.id,
    examType: booking.examType,
    startsAt: booking.startsAt,
    issuedAt: current.issuedAt,
    amended: current.status === 'amended',
    summary:
      current.items && flagged ? { items: current.items.length, outOfRange: flagged.length, flagged } : null,
  };
}

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

  async patientResults(pagination: Pagination, actor: Actor): Promise<Page<ExamResultSummary>> {
    const page = await this.repository.patientResults(pagination, actor);
    return { ...page, items: page.items.map(summaryOf) };
  }

  async patientPdf(bookingId: string, actor: Actor, patientName: string) {
    const result = await this.patientResult(bookingId, actor);
    return { fileName: resultFileName(result), pdf: await renderResultPdf(result, patientName, this.clock.now()) };
  }

  async doctorResults(patientId: string, pagination: Pagination, actor: Actor): Promise<Page<ExamResult>> {
    const page = await this.repository.doctorResults(patientId, pagination, actor, this.clock.now());
    if (!page) throw new AppError(403, noExamReview.code, noExamReview.message);
    return page;
  }
}
