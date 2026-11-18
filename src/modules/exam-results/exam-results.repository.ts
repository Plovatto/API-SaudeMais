import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import { bookings } from '../../database/schema/bookings.js';
import { examTypes, units } from '../../database/schema/catalog.js';
import { examResults, examResultVersions, type ResultPayloadItem } from '../../database/schema/exam-results.js';
import { recordAudit, type Actor } from '../../lib/audit.js';
import { pageOf, type Page, type Pagination } from '../../lib/pagination.js';
import { DAY } from '../../lib/time.js';
import { hasResult, placeColumns } from '../bookings/bookings.repository.js';
import { aboutItem } from './exam-results.glossary.js';
import type { ExamResult, ExamResultVersion, ResultItemView } from './exam-results.model.js';
import { parseReferenceRange } from './reference-range.js';

const REVIEW_WINDOW = 30 * DAY;

const describeItem = (item: ResultPayloadItem): ResultItemView => ({
  ...item,
  range: parseReferenceRange(item.referenceRange),
  about: aboutItem(item.name),
});

const resultColumns = {
  resultId: examResults.id,
  id: bookings.id,
  publicCode: sql<string>`${bookings.publicCode}`,
  examType: { id: examTypes.id, name: examTypes.name, kind: examTypes.kind },
  unit: placeColumns.unit,
  startsAt: bookings.startsAt,
};

const examReviewWith = (doctorId: string, patientId: string, now: Date): SQL | undefined =>
  and(
    eq(bookings.kind, 'appointment'),
    eq(bookings.doctorId, doctorId),
    eq(bookings.patientId, patientId),
    eq(bookings.visitType, 'exam_review'),
    inArray(bookings.status, ['confirmed', 'completed']),
    lte(bookings.startsAt, now),
    gte(bookings.startsAt, new Date(now.getTime() - REVIEW_WINDOW)),
  );

function resultsQuery(tx: Transaction, where: SQL | undefined) {
  return tx
    .select(resultColumns)
    .from(examResults)
    .innerJoin(bookings, eq(bookings.id, examResults.bookingId))
    .innerJoin(examTypes, eq(examTypes.id, bookings.examTypeId))
    .innerJoin(units, eq(units.id, bookings.unitId))
    .where(where)
    .orderBy(desc(bookings.startsAt), asc(bookings.id))
    .$dynamic();
}

type ResultRow = Awaited<ReturnType<typeof resultsQuery>>[number];

async function versionsOf(tx: Transaction, resultIds: string[]) {
  const rows = await tx
    .select({
      resultId: examResultVersions.resultId,
      version: examResultVersions.version,
      status: examResultVersions.status,
      issuedAt: examResultVersions.issuedAt,
      receivedAt: examResultVersions.receivedAt,
      payload: examResultVersions.payload,
    })
    .from(examResultVersions)
    .where(inArray(examResultVersions.resultId, resultIds))
    .orderBy(desc(examResultVersions.version));
  const byResult = new Map<string, ExamResultVersion[]>();
  for (const { resultId, issuedAt, receivedAt, payload, ...version } of rows) {
    const { items, report = null } = payload;
    const versions = byResult.get(resultId) ?? [];
    versions.push({
      ...version,
      issuedAt: issuedAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      items: items?.map(describeItem) ?? null,
      report,
    });
    byResult.set(resultId, versions);
  }
  return byResult;
}

async function readResults(tx: Transaction, rows: ResultRow[], actor: Actor): Promise<ExamResult[]> {
  if (rows.length === 0) return [];
  const versions = await versionsOf(
    tx,
    rows.map((row) => row.resultId),
  );
  const results: ExamResult[] = [];
  for (const { resultId, startsAt, ...booking } of rows) {
    const [current, ...previous] = versions.get(resultId) ?? [];
    if (!current) throw new Error(`Exam result ${resultId} has no version`);
    await recordAudit(tx, {
      ...actor,
      action: 'exam_result.read',
      entityType: 'exam_result',
      entityId: resultId,
      metadata: { bookingId: booking.id, version: current.version },
    });
    results.push({ booking: { ...booking, startsAt: startsAt.toISOString() }, current, previous });
  }
  return results;
}

async function resultsPage(
  tx: Transaction,
  ofPatient: SQL,
  pagination: Pagination,
  actor: Actor,
): Promise<Page<ExamResult>> {
  const page = await pageOf(resultsQuery(tx, ofPatient), pagination, () =>
    tx.$count(bookings, and(ofPatient, hasResult)),
  );
  return { ...page, items: await readResults(tx, page.items, actor) };
}

export class ExamResultsRepository {
  constructor(private readonly db: Database) {}

  patientResult(bookingId: string, actor: Actor): Promise<ExamResult | undefined> {
    return this.db.transaction(async (tx) => {
      const rows = await resultsQuery(tx, and(eq(bookings.id, bookingId), eq(bookings.patientId, actor.actorId)));
      const [result] = await readResults(tx, rows, actor);
      return result;
    });
  }

  patientResults(pagination: Pagination, actor: Actor): Promise<Page<ExamResult>> {
    return this.db.transaction(async (tx) => {
      return resultsPage(tx, eq(bookings.patientId, actor.actorId), pagination, actor);
    });
  }

  doctorResults(
    patientId: string,
    pagination: Pagination,
    actor: Actor,
    now: Date,
  ): Promise<Page<ExamResult> | undefined> {
    return this.db.transaction(async (tx) => {
      if ((await tx.$count(bookings, examReviewWith(actor.actorId, patientId, now))) === 0) return undefined;
      return resultsPage(tx, eq(bookings.patientId, patientId), pagination, actor);
    });
  }
}
