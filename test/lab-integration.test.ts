import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { integrationClients } from '@/database/schema/integration-clients.js';
import { hashToken } from '@/modules/users/user.token.js';
import { UNKNOWN_ID } from './support/agenda.js';
import { setupClinic, type Clinic } from './support/doctors.js';
import { insertExam, offerOf, type Offer } from './support/exams.js';
import {
  createIntegrationClient,
  ISSUED_AT,
  postIntegrationClient,
  publishResult,
  rowsOf,
  valueOf,
  type ClientBody,
  type Exam,
} from './support/lab.js';
import { anyText, as, createAdmin, createPatient, START } from './support/users.js';

const API_KEY = /^slab_([0-9a-f]{8})_[A-Za-z0-9_-]{43}$/;
const ITEMS = [
  { name: 'Hemoglobina', value: 13.8, unit: 'g/dL', referenceRange: '12,0 a 16,0', flag: 'normal' },
  { name: 'Leucócitos', value: 'Ausentes', flag: 'low' },
];
const STORED_ITEMS = [ITEMS[0], { ...ITEMS[1], unit: null, referenceRange: null }];

let context: Clinic;
let admin: string;
let patientId: string;
let lab: string;
let hemograma: Offer;
let ultrassom: Offer;

beforeAll(async () => {
  context = await setupClinic();
  admin = await createAdmin(context, 'admin.lab@email.com');
  await createPatient(context, 'paciente.lab@email.com');
  patientId = await one<string>(sql`select id as value from users where email = 'paciente.lab@email.com'`);
  hemograma = await offerOf(context, 'Unidade Central', 'hemograma');
  ultrassom = await offerOf(context, 'Unidade Central', 'ultrassom');
  lab = (await createIntegrationClient(context.app, admin)).apiKey ?? '';
}, 60_000);

const rows = <T>(query: ReturnType<typeof sql>) => rowsOf<T>(context.db, query);

const one = <T>(query: ReturnType<typeof sql>) => valueOf<T>(context.db, query);

const createClient = (name: string, token = admin) => postIntegrationClient(context.app, token, name);

const revoke = (id: string) => request(context.app).post(`/api/admin/integration-clients/${id}/revoke`).set(as(admin));

const worklist = (date: string, key = lab) =>
  request(context.app).get('/api/integrations/lab/worklist').query({ date }).set('X-Api-Key', key);

const publish = (body: Record<string, unknown>, key = lab) => publishResult(context.app, key, body);

const labResult = (exam: Exam, overrides: Record<string, unknown> = {}) => ({
  externalId: `LAB-${exam.code}`,
  examCode: exam.code,
  status: 'final',
  issuedAt: ISSUED_AT,
  items: ITEMS,
  ...overrides,
});

const examAt = (offer: Offer, startsAt: string, status: 'confirmed' | 'completed' | 'cancelled' = 'confirmed') =>
  insertExam(context, {
    patientId,
    ...offer,
    startsAt: new Date(startsAt),
    status,
    ...(status === 'cancelled' ? { cancelledAt: START, cancelledByRole: 'system' as const } : {}),
  });

const notificationsOf = (exam: Exam) =>
  rows<{ type: string; user_id: string; params: Record<string, unknown> }>(
    sql`select type, user_id, params from notifications where booking_id = ${exam.id} order by created_at, id`,
  );

const eventsOf = (exam: Exam) =>
  rows<{ event_type: string; actor_type: string; from_status: string; to_status: string }>(sql`
    select event_type, actor_type, from_status, to_status from booking_events
    where booking_id = ${exam.id} order by created_at, id
  `);

const versionsOf = (exam: Exam) =>
  rows<{ version: number; status: string; payload: Record<string, unknown> }>(sql`
    select v.version, v.status, v.payload from exam_result_versions v
    join exam_results r on r.id = v.result_id where r.booking_id = ${exam.id} order by v.version
  `);

const statusOf = (exam: Exam) => one<string>(sql`select status as value from bookings where id = ${exam.id}`);

describe('integration clients', () => {
  it('shows the key once, stores only its hash and audits the creation', async () => {
    const response = await createClient('Laboratório Central').expect(201);
    const client = response.body as ClientBody;

    const match = API_KEY.exec(client.apiKey ?? '');
    expect(match?.[1]).toBe(client.keyPrefix);
    expect(client).toMatchObject({ name: 'Laboratório Central', lastUsedAt: null, revokedAt: null });
    const [stored] = await rows<{ api_key_hash: string; key_prefix: string }>(
      sql`select api_key_hash, key_prefix from integration_clients where id = ${client.id}`,
    );
    expect(stored).toEqual({ api_key_hash: hashToken(client.apiKey ?? ''), key_prefix: client.keyPrefix });
    const page = await request(context.app).get('/api/admin/integration-clients').set(as(admin)).expect(200);
    const listed = (page.body as { items: ClientBody[] }).items.find((item) => item.id === client.id);
    expect(listed).toEqual({ ...client, apiKey: undefined });
    expect(JSON.stringify(page.body)).not.toMatch(/apiKey|Hash|slab_/);
    const [audit] = await rows<{ action: string; metadata: Record<string, unknown> }>(
      sql`select action, metadata from audit_logs where entity_id = ${client.id}`,
    );
    expect(audit).toEqual({ action: 'integration_client.created', metadata: { keyPrefix: client.keyPrefix } });
  });

  it('refuses a repeated name regardless of case and non-admins', async () => {
    const taken = await createClient('laboratório central').expect(409);
    expect(taken.body).toMatchObject({ code: 'NAME_TAKEN' });
    await createClient('Outro Laboratório', context.patient).expect(403);
    await request(context.app).get('/api/admin/integration-clients').expect(401);
  });

  it('revokes a key right away, once, and audits it', async () => {
    const client = await createIntegrationClient(context.app, admin);
    await worklist('2026-11-20', client.apiKey).expect(200);

    const revoked = (await revoke(client.id).expect(200)).body as ClientBody;

    expect(revoked.revokedAt).toBe(START.toISOString());
    expect((await worklist('2026-11-20', client.apiKey).expect(401)).body).toMatchObject({ code: 'INVALID_API_KEY' });
    expect((await revoke(client.id).expect(200)).body).toEqual(revoked);
    const actions = await rows<{ action: string }>(
      sql`select action from audit_logs where entity_id = ${client.id} order by created_at, id`,
    );
    expect(actions.map(({ action }) => action)).toEqual(['integration_client.created', 'integration_client.revoked']);
    await revoke(UNKNOWN_ID).expect(404);
  });
});

describe('api key authentication', () => {
  it('answers 401 without a key, with a malformed key or with an unknown key', async () => {
    const forged = lab.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A'));
    for (const key of ['', 'slab_123', lab.toUpperCase(), forged]) {
      const response = await worklist('2026-11-20', key).expect(401);
      expect(response.body).toEqual({
        message: 'Chave de API ausente, inválida ou revogada.',
        code: 'INVALID_API_KEY',
      });
    }
    await request(context.app).get('/api/integrations/lab/worklist').query({ date: '2026-11-20' }).expect(401);
  });

  it('records the last use at most every 5 minutes', async () => {
    const client = await createIntegrationClient(context.app, admin);
    const lastUsed = async () =>
      (
        await context.db
          .select({ at: integrationClients.lastUsedAt })
          .from(integrationClients)
          .where(eq(integrationClients.id, client.id))
      )[0]?.at;

    await worklist('2026-11-20', client.apiKey).expect(200);
    expect(await lastUsed()).toEqual(START);
    const recent = new Date(START.getTime() - 4 * 60_000);
    await context.db.execute(sql`update integration_clients set last_used_at = ${recent} where id = ${client.id}`);
    await worklist('2026-11-20', client.apiKey).expect(200);
    expect(await lastUsed()).toEqual(recent);
    await context.db.execute(
      sql`update integration_clients set last_used_at = ${new Date(START.getTime() - 5 * 60_000)} where id = ${client.id}`,
    );
    await worklist('2026-11-20', client.apiKey).expect(200);
    expect(await lastUsed()).toEqual(START);
  });

  it('limits each key to 60 requests per minute without affecting other keys', async () => {
    const client = await createIntegrationClient(context.app, admin);
    for (let attempt = 0; attempt < 60; attempt += 1) await worklist('2026-11-21', client.apiKey).expect(200);

    expect((await worklist('2026-11-21', client.apiKey).expect(429)).body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    await worklist('2026-11-21').expect(200);
  });
});

describe('GET /api/integrations/lab/worklist', () => {
  it('lists only the eligible exams of the São Paulo day that still have no result, without personal data', async () => {
    const started = await examAt(hemograma, '2026-11-20T10:00:00.000Z');
    const completed = await examAt(ultrassom, '2026-11-20T11:00:00.000Z', 'completed');
    const midnight = await examAt(hemograma, '2026-11-20T03:00:00.000Z');
    const dayBefore = await examAt(hemograma, '2026-11-20T02:50:00.000Z');
    const future = await examAt(hemograma, '2026-11-20T15:00:00.000Z');
    const cancelled = await examAt(hemograma, '2026-11-20T10:30:00.000Z', 'cancelled');
    const resulted = await examAt(hemograma, '2026-11-20T09:00:00.000Z');
    await publish(labResult(resulted)).expect(201);

    const items = (await worklist('2026-11-20').expect(200)).body as Record<string, unknown>[];

    const codes = items.map((item) => item.examCode);
    expect(codes).toEqual(expect.arrayContaining([midnight.code, started.code, completed.code]));
    for (const excluded of [dayBefore, future, cancelled, resulted]) expect(codes).not.toContain(excluded.code);
    expect(items.find((item) => item.examCode === completed.code)).toEqual({
      examCode: completed.code,
      examTypeCode: 'ultrassom',
      startsAt: '2026-11-20T11:00:00.000Z',
    });
    expect(codes.indexOf(midnight.code)).toBeLessThan(codes.indexOf(started.code));
    const previous = (await worklist('2026-11-19').expect(200)).body as { examCode: string }[];
    expect(previous.map((item) => item.examCode)).toContain(dayBefore.code);
  });

  it('requires a date in YYYY-MM-DD', async () => {
    await worklist('20/11/2026').expect(400);
    await request(context.app).get('/api/integrations/lab/worklist').set('X-Api-Key', lab).expect(400);
  });
});

describe('POST /api/integrations/lab/results', () => {
  it('creates the first version, completes the exam, notifies the patient and audits without the payload', async () => {
    const exam = await examAt(hemograma, '2026-11-19T13:00:00.000Z');

    const response = await publish(labResult(exam)).expect(201);

    expect(response.body).toEqual({
      examCode: exam.code,
      externalId: `LAB-${exam.code}`,
      version: 1,
      outcome: 'created',
    });
    expect(await versionsOf(exam)).toEqual([{ version: 1, status: 'final', payload: { items: STORED_ITEMS } }]);
    expect(await statusOf(exam)).toBe('completed');
    expect(await eventsOf(exam)).toEqual([
      { event_type: 'result_received', actor_type: 'integration', from_status: 'confirmed', to_status: 'completed' },
    ]);
    expect(await notificationsOf(exam)).toEqual([
      { type: 'exam_result_available', user_id: patientId, params: { startsAt: '2026-11-19T13:00:00.000Z' } },
    ]);
    const audits = await rows<{ actor_type: string; action: string; entity_type: string; metadata: unknown }>(sql`
      select actor_type, action, entity_type, metadata from audit_logs
      where metadata->>'bookingId' = ${exam.id}
    `);
    expect(audits).toEqual([
      {
        actor_type: 'integration',
        action: 'exam_result.created',
        entity_type: 'exam_result',
        metadata: { bookingId: exam.id, version: 1, status: 'final' },
      },
    ]);
  });

  it('ignores a replay with the same content, even marked as amended', async () => {
    const exam = await examAt(hemograma, '2026-11-19T13:20:00.000Z');
    await publish(labResult(exam)).expect(201);

    const replay = await publish(labResult(exam, { issuedAt: '2026-11-20T11:45:00.000Z' })).expect(200);
    const amendedReplay = await publish(labResult(exam, { status: 'amended', items: STORED_ITEMS })).expect(200);

    expect(replay.body).toMatchObject({ version: 1, outcome: 'unchanged' });
    expect(amendedReplay.body).toMatchObject({ version: 1, outcome: 'unchanged' });
    expect(await versionsOf(exam)).toHaveLength(1);
    expect(await notificationsOf(exam)).toHaveLength(1);
    expect(await eventsOf(exam)).toHaveLength(1);
  });

  it('keeps each amendment as a new immutable version and notifies the patient again', async () => {
    const exam = await examAt(hemograma, '2026-11-19T13:40:00.000Z');
    await publish(labResult(exam)).expect(201);
    const corrected = [{ ...STORED_ITEMS[0], value: 9.1, flag: 'low' }];

    const response = await publish(labResult(exam, { status: 'amended', items: corrected })).expect(200);

    expect(response.body).toMatchObject({ version: 2, outcome: 'amended' });
    expect(await versionsOf(exam)).toEqual([
      { version: 1, status: 'final', payload: { items: STORED_ITEMS } },
      { version: 2, status: 'amended', payload: { items: corrected } },
    ]);
    expect((await notificationsOf(exam)).map(({ type }) => type)).toEqual([
      'exam_result_available',
      'exam_result_available',
    ]);
    expect((await eventsOf(exam)).map(({ from_status, to_status }) => `${from_status}>${to_status}`)).toEqual([
      'confirmed>completed',
      'completed>completed',
    ]);
    await expect(
      context.db.execute(sql`update exam_result_versions set status = 'final' where version = 2`),
    ).rejects.toThrow();
    expect((await versionsOf(exam))[1]?.status).toBe('amended');
  });

  it('refuses different content as final, another externalId and another client for the same exam', async () => {
    const exam = await examAt(hemograma, '2026-11-19T14:00:00.000Z');
    await publish(labResult(exam)).expect(201);
    const other = (await createIntegrationClient(context.app, admin)).apiKey ?? '';

    const final = await publish(labResult(exam, { items: [ITEMS[0]] })).expect(409);
    const otherId = await publish(labResult(exam, { externalId: 'LAB-OUTRO' })).expect(409);
    const otherClient = await publish(labResult(exam), other).expect(409);

    expect(final.body).toMatchObject({ code: 'RESULT_FINAL', fields: { status: anyText } });
    expect(otherId.body).toMatchObject({ code: 'RESULT_EXISTS' });
    expect(otherClient.body).toMatchObject({ code: 'RESULT_EXISTS' });
    expect(await versionsOf(exam)).toHaveLength(1);
  });

  it('refuses an externalId already used for another exam', async () => {
    const first = await examAt(hemograma, '2026-11-19T14:20:00.000Z');
    const second = await examAt(hemograma, '2026-11-19T14:40:00.000Z');
    await publish(labResult(first)).expect(201);

    const reused = await publish(labResult(second, { externalId: `LAB-${first.code}` })).expect(409);

    expect(reused.body).toMatchObject({ code: 'EXTERNAL_ID_TAKEN' });
    expect(await statusOf(second)).toBe('confirmed');
  });

  it('takes a report for imaging and items for lab exams', async () => {
    const imaging = await examAt(ultrassom, '2026-11-19T15:00:00.000Z', 'completed');
    const labExam = await examAt(hemograma, '2026-11-19T15:20:00.000Z');

    const itemsOnImaging = await publish(labResult(imaging)).expect(422);
    const reportOnLab = await publish(labResult(labExam, { items: undefined, report: 'Sem alterações.' })).expect(422);
    await publish(labResult(labExam, { report: 'Sem alterações.' })).expect(400);
    await publish(labResult(labExam, { items: undefined })).expect(400);
    await publish(labResult(labExam, { items: [{ ...ITEMS[0], flag: 'unknown' }] })).expect(400);
    const report = await publish(labResult(imaging, { items: undefined, report: 'Fígado normal.\nSem achados.' }));

    expect(itemsOnImaging.body).toMatchObject({
      code: 'WRONG_RESULT_FORMAT',
      fields: { report: anyText },
    });
    expect(reportOnLab.body).toMatchObject({
      code: 'WRONG_RESULT_FORMAT',
      fields: { items: anyText },
    });
    expect(report.status).toBe(201);
    expect(await versionsOf(imaging)).toEqual([
      { version: 1, status: 'final', payload: { report: 'Fígado normal.\nSem achados.' } },
    ]);
    expect(await eventsOf(imaging)).toEqual([
      { event_type: 'result_received', actor_type: 'integration', from_status: 'completed', to_status: 'completed' },
    ]);
  });

  it('refuses an issuedAt more than 5 minutes ahead of the clock', async () => {
    const exam = await examAt(hemograma, '2026-11-19T16:40:00.000Z');

    const ahead = await publish(labResult(exam, { issuedAt: '2026-11-20T12:05:01.000Z' })).expect(422);
    await publish(labResult(exam, { issuedAt: '2026-11-20T12:05:00.000Z' })).expect(201);

    expect(ahead.body).toMatchObject({ code: 'ISSUED_IN_FUTURE', fields: { issuedAt: anyText } });
  });

  it('answers 404 for an unknown code and NOT_ELIGIBLE for future or cancelled exams', async () => {
    const future = await examAt(hemograma, '2026-11-20T16:00:00.000Z');
    const cancelled = await examAt(hemograma, '2026-11-19T16:00:00.000Z', 'cancelled');

    const unknown = await publish(labResult({ id: UNKNOWN_ID, code: 'EX-000000' })).expect(404);
    const early = await publish(labResult(future)).expect(422);
    await publish(labResult(cancelled)).expect(422);

    expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(early.body).toMatchObject({ code: 'NOT_ELIGIBLE', fields: { examCode: anyText } });
    expect(await statusOf(future)).toBe('confirmed');
    expect(await notificationsOf(future)).toEqual([]);
  });

  it('keeps result values out of the audit and the notifications', async () => {
    const exam = await examAt(hemograma, '2026-11-19T16:20:00.000Z');
    const secret = { name: 'Marcador sigiloso', value: 'VALOR-SIGILOSO-123', flag: 'critical' };

    await publish(labResult(exam, { items: [secret] })).expect(201);

    const audit = await rows<{ metadata: unknown }>(sql`select metadata from audit_logs`);
    const notices = await rows<{ params: unknown }>(sql`select params from notifications`);
    expect(JSON.stringify([audit, notices])).not.toMatch(/SIGILOSO|sigiloso/);
  });
});
