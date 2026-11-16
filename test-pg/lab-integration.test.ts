import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { hashToken } from '@/modules/users/user.token.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const API_KEY = `slab_0a1b2c3d_${'k'.repeat(43)}`;
const EXAM_CODE = 'EX-7F3K2Q';

describe('lab results on PostgreSQL', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildTestApp>['app'];

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
    app = context.app;
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    await pool.query(
      `insert into integration_clients (name, key_prefix, api_key_hash, created_by)
       select 'Laboratório Central', '0a1b2c3d', $1, id from users order by created_at limit 1`,
      [hashToken(API_KEY)],
    );
    await pool.query(
      `insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
       select 'exam', patient.id, o.unit_id, o.exam_type_id, $1, 1, '2026-11-19T13:00:00Z', '2026-11-19T13:10:00Z',
         'confirmed'
       from users patient, unit_exam_offers o join exam_types e on e.id = o.exam_type_id
       where patient.email = 'andreia.soares@saudemais.test' and e.code = 'hemograma'
       limit 1`,
      [EXAM_CODE],
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  const publish = (value: number) =>
    request(app)
      .post('/api/integrations/lab/results')
      .set('X-Api-Key', API_KEY)
      .send({
        externalId: 'LAB-1',
        examCode: EXAM_CODE,
        status: 'final',
        issuedAt: '2026-11-20T11:00:00.000Z',
        items: [{ name: 'Hemoglobina', value, unit: 'g/dL', referenceRange: '12,0 a 16,0', flag: 'normal' }],
      });

  const count = async (table: string) =>
    (await pool.query<{ total: number }>(`select count(*)::int as total from ${table}`)).rows[0]?.total;

  it('creates one result when the same publication arrives twice at once', async () => {
    const responses = await Promise.all([publish(13.8), publish(13.8)]);

    expect(responses.map(({ body }) => (body as { outcome: string }).outcome).sort()).toEqual(['created', 'unchanged']);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect([await count('exam_results'), await count('exam_result_versions')]).toEqual([1, 1]);
    expect(await count("notifications where type = 'exam_result_available'")).toBe(1);
  });

  it('accepts one of two different final results sent at once and refuses the other', async () => {
    const responses = await Promise.all([publish(13.8), publish(9.1)]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body).toMatchObject({ code: 'RESULT_FINAL' });
    expect(await count('exam_result_versions')).toBe(1);
  });

  it('never lets a stored result or version change, but lets results be deleted with their versions', async () => {
    await publish(13.8).expect(201);

    await expect(pool.query("update exam_result_versions set status = 'amended'")).rejects.toThrow(/immutable/);
    await expect(pool.query("update exam_results set external_id = 'LAB-2'")).rejects.toThrow(/immutable/);
    await pool.query('delete from exam_results');
    expect([await count('exam_results'), await count('exam_result_versions')]).toEqual([0, 0]);
  });
});
