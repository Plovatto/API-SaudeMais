import { and, asc, desc, eq, exists, gte, isNull, lt, not, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import { bookings } from '../../database/schema/bookings.js';
import { examTypes } from '../../database/schema/catalog.js';
import { examResults, examResultVersions } from '../../database/schema/exam-results.js';
import { integrationClients } from '../../database/schema/integration-clients.js';
import { recordAudit, type Actor } from '../../lib/audit.js';
import { pageOf, type Page, type Pagination } from '../../lib/pagination.js';
import type { DayRange } from '../../lib/time.js';
import type { IntegrationClient, Worklist } from './lab-integration.model.js';

interface NewClient {
  name: string;
  keyPrefix: string;
  apiKeyHash: string;
  createdAt: Date;
}

type NewResult = typeof examResults.$inferInsert;
type NewVersion = typeof examResultVersions.$inferInsert;

const clientColumns = {
  id: integrationClients.id,
  name: integrationClients.name,
  keyPrefix: integrationClients.keyPrefix,
  createdAt: integrationClients.createdAt,
  lastUsedAt: integrationClients.lastUsedAt,
  revokedAt: integrationClients.revokedAt,
};

interface ClientRow {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

function viewOf({ createdAt, lastUsedAt, revokedAt, ...client }: ClientRow): IntegrationClient {
  return { ...client, createdAt: createdAt.toISOString(), lastUsedAt: iso(lastUsedAt), revokedAt: iso(revokedAt) };
}

const eligibleAt = (now: Date) =>
  sql<boolean>`(${bookings.status} = 'completed' or (${bookings.status} = 'confirmed' and ${bookings.startsAt} <= ${now}))`;

export class LabIntegrationRepository {
  constructor(private readonly db: Database) {}

  async clientPage(pagination: Pagination): Promise<Page<IntegrationClient>> {
    const query = this.db
      .select(clientColumns)
      .from(integrationClients)
      .orderBy(asc(integrationClients.name))
      .$dynamic();
    const page = await pageOf(query, pagination, () => this.db.$count(integrationClients));
    return { ...page, items: page.items.map(viewOf) };
  }

  createClient({ createdAt, ...client }: NewClient, actor: Actor): Promise<IntegrationClient> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(integrationClients)
        .values({ ...client, createdBy: actor.actorId, createdAt })
        .returning(clientColumns);
      if (!row) throw new Error('Insert into integration_clients returned no row');
      await this.audit(tx, 'created', row, actor);
      return viewOf(row);
    });
  }

  revokeClient(id: string, actor: Actor, now: Date): Promise<IntegrationClient | undefined> {
    return this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(integrationClients)
        .set({ revokedAt: now })
        .where(and(eq(integrationClients.id, id), isNull(integrationClients.revokedAt)))
        .returning(clientColumns);
      if (revoked) await this.audit(tx, 'revoked', revoked, actor);
      const [row] = revoked
        ? [revoked]
        : await tx.select(clientColumns).from(integrationClients).where(eq(integrationClients.id, id));
      return row && viewOf(row);
    });
  }

  async activeClient(apiKeyHash: string) {
    const [row] = await this.db
      .select({ id: integrationClients.id, lastUsedAt: integrationClients.lastUsedAt })
      .from(integrationClients)
      .where(and(eq(integrationClients.apiKeyHash, apiKeyHash), isNull(integrationClients.revokedAt)));
    return row;
  }

  async touchClient(id: string, now: Date): Promise<void> {
    await this.db.update(integrationClients).set({ lastUsedAt: now }).where(eq(integrationClients.id, id));
  }

  async worklist({ start, end }: DayRange, now: Date): Promise<Worklist> {
    const resulted = this.db
      .select({ id: examResults.id })
      .from(examResults)
      .where(eq(examResults.bookingId, bookings.id));
    const rows = await this.db
      .select({
        examCode: sql<string>`${bookings.publicCode}`,
        examTypeCode: examTypes.code,
        startsAt: bookings.startsAt,
      })
      .from(bookings)
      .innerJoin(examTypes, eq(examTypes.id, bookings.examTypeId))
      .where(
        and(
          eq(bookings.kind, 'exam'),
          gte(bookings.startsAt, start),
          lt(bookings.startsAt, end),
          eligibleAt(now),
          not(exists(resulted)),
        ),
      )
      .orderBy(asc(bookings.startsAt), asc(bookings.publicCode));
    return rows.map((row) => ({ ...row, startsAt: row.startsAt.toISOString() }));
  }

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async lockExam(tx: Transaction, examCode: string, now: Date) {
    const [row] = await tx
      .select({ id: bookings.id, kind: examTypes.kind, eligible: eligibleAt(now) })
      .from(bookings)
      .innerJoin(examTypes, eq(examTypes.id, bookings.examTypeId))
      .where(and(eq(bookings.publicCode, examCode), eq(bookings.kind, 'exam')))
      .for('no key update', { of: bookings });
    return row;
  }

  async resultOf(tx: Transaction, bookingId: string) {
    const [row] = await tx
      .select({ id: examResults.id, clientId: examResults.clientId, externalId: examResults.externalId })
      .from(examResults)
      .where(eq(examResults.bookingId, bookingId));
    return row;
  }

  async latestVersion(tx: Transaction, resultId: string, payload: Record<string, unknown>) {
    const [row] = await tx
      .select({
        version: examResultVersions.version,
        same: sql<boolean>`${examResultVersions.payload} = ${JSON.stringify(payload)}::jsonb`,
      })
      .from(examResultVersions)
      .where(eq(examResultVersions.resultId, resultId))
      .orderBy(desc(examResultVersions.version))
      .limit(1);
    return row;
  }

  async createResult(tx: Transaction, result: NewResult): Promise<string> {
    const [row] = await tx.insert(examResults).values(result).returning({ id: examResults.id });
    if (!row) throw new Error('Insert into exam_results returned no row');
    return row.id;
  }

  async addVersion(tx: Transaction, version: NewVersion): Promise<void> {
    await tx.insert(examResultVersions).values(version);
  }

  private audit(tx: Transaction, action: string, { id, keyPrefix }: ClientRow, actor: Actor) {
    return recordAudit(tx, {
      ...actor,
      action: `integration_client.${action}`,
      entityType: 'integration_client',
      entityId: id,
      metadata: { keyPrefix },
    });
  }
}
