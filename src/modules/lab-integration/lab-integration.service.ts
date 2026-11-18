import { randomBytes } from 'node:crypto';
import { runAfterCommit, type AfterCommit, type Transaction } from '../../database/pg-client.js';
import { conflictError, notFound, unprocessableField } from '../../lib/app-error.js';
import { recordAudit, type Actor, type AuditActor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import type { Pagination } from '../../lib/pagination.js';
import { retryOnDeadlock } from '../../lib/pg-errors.js';
import { CLINIC_TIME_ZONE, dayRangeIn, instantOfWallClock, MINUTE } from '../../lib/time.js';
import { recordResult } from '../bookings/bookings.repository.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { TOUCH_INTERVAL } from '../users/user.service.js';
import { createSessionToken, hashToken, isWellFormedToken } from '../users/user.token.js';
import {
  clientConflicts,
  clientNotFound,
  examNotFound,
  issuedInFuture,
  notEligible,
  resultConflicts,
  wrongFormat,
} from './lab-integration.messages.js';
import type {
  CreateClientInput,
  CreatedClient,
  IntegrationClient,
  ResultInput,
  ResultReceipt,
  Worklist,
} from './lab-integration.model.js';
import type { LabIntegrationRepository } from './lab-integration.repository.js';

const ISSUED_AT_SKEW = 5 * MINUTE;
const API_KEY_PATTERN = /^slab_[0-9a-f]{8}_(.+)$/;

interface Publication {
  receipt: ResultReceipt;
  afterCommit?: AfterCommit;
}

interface Publisher {
  clientId: string;
  ip: string | null;
}

function newApiKey() {
  const keyPrefix = randomBytes(4).toString('hex');
  const apiKey = `slab_${keyPrefix}_${createSessionToken().token}`;
  return { keyPrefix, apiKey, apiKeyHash: hashToken(apiKey) };
}

function payloadOf(kind: keyof typeof wrongFormat, { items, report }: Pick<ResultInput, 'items' | 'report'>) {
  if (kind === 'lab' && items) return { items };
  if (kind === 'imaging' && report !== undefined) return { report };
  throw unprocessableField(wrongFormat[kind]);
}

export class LabIntegrationService {
  constructor(
    private readonly repository: LabIntegrationRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  clientPage(pagination: Pagination) {
    return this.repository.clientPage(pagination);
  }

  async createClient({ name }: CreateClientInput, actor: AuditActor): Promise<CreatedClient> {
    const { apiKey, ...key } = newApiKey();
    const client = await withConstraintConflicts(
      () => this.repository.createClient({ name, ...key, createdAt: this.clock.now() }, actor),
      clientConflicts,
    );
    return { ...client, apiKey };
  }

  async revokeClient(id: string, actor: Actor): Promise<IntegrationClient> {
    const client = await this.repository.revokeClient(id, actor, this.clock.now());
    if (!client) throw notFound(clientNotFound);
    return client;
  }

  async authenticate(apiKey: string): Promise<string | null> {
    const secret = API_KEY_PATTERN.exec(apiKey)?.[1];
    if (!secret || !isWellFormedToken(secret)) return null;
    const client = await this.repository.activeClient(hashToken(apiKey));
    if (!client) return null;
    const now = this.clock.now();
    if (!client.lastUsedAt || now.getTime() - client.lastUsedAt.getTime() >= TOUCH_INTERVAL) {
      await this.repository.touchClient(client.id, now);
    }
    return client.id;
  }

  worklist(date: string): Promise<Worklist> {
    const day = dayRangeIn(CLINIC_TIME_ZONE, instantOfWallClock(CLINIC_TIME_ZONE, Date.parse(date)));
    return this.repository.worklist(day, this.clock.now());
  }

  async publish(input: ResultInput, publisher: Publisher): Promise<ResultReceipt> {
    const { receipt, afterCommit } = await withConstraintConflicts(
      () => retryOnDeadlock(() => this.repository.transaction((tx) => this.receive(tx, input, publisher))),
      resultConflicts,
    );
    runAfterCommit(afterCommit);
    return receipt;
  }

  private async receive(
    tx: Transaction,
    { externalId, examCode, status, issuedAt, ...content }: ResultInput,
    { clientId, ip }: Publisher,
  ): Promise<Publication> {
    const now = this.clock.now();
    if (Date.parse(issuedAt) > now.getTime() + ISSUED_AT_SKEW) throw unprocessableField(issuedInFuture);
    const exam = await this.repository.lockExam(tx, examCode, now);
    if (!exam) throw notFound(examNotFound);
    if (!exam.eligible) throw unprocessableField(notEligible);
    const payload = payloadOf(exam.kind, content);
    const existing = await this.repository.resultOf(tx, exam.id);
    if (existing && (existing.clientId !== clientId || existing.externalId !== externalId)) {
      throw conflictError(resultConflicts.otherResult);
    }
    const latest = existing && (await this.repository.latestVersion(tx, existing.id, payload));
    if (latest?.same) return { receipt: { examCode, externalId, version: latest.version, outcome: 'unchanged' } };
    if (latest && status === 'final') throw conflictError(resultConflicts.final);
    const version = (latest?.version ?? 0) + 1;
    const resultId =
      existing?.id ??
      (await this.repository.createResult(tx, { bookingId: exam.id, clientId, externalId, createdAt: now }));
    await this.repository.addVersion(tx, {
      resultId,
      version,
      status,
      issuedAt: new Date(issuedAt),
      receivedAt: now,
      payload,
    });
    const completed = await recordResult(tx, exam.id, now);
    await recordAudit(tx, {
      actorType: 'integration',
      actorId: clientId,
      action: version === 1 ? 'exam_result.created' : 'exam_result.amended',
      entityType: 'exam_result',
      entityId: resultId,
      metadata: { bookingId: exam.id, version, status },
      ip,
    });
    const afterCommit = await this.notifications.notify(
      tx,
      completed.map((booking) => ({
        userId: booking.patientId,
        audienceRole: 'patient' as const,
        type: 'exam_result_available' as const,
        bookingId: booking.id,
        params: { startsAt: booking.startsAt.toISOString() },
      })),
    );
    return { receipt: { examCode, externalId, version, outcome: version === 1 ? 'created' : 'amended' }, afterCommit };
  }
}
