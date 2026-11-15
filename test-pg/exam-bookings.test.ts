import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { as, signUp, START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const CAPACITY = 3;
const STARTS_AT = '2026-11-23T13:00:00.000Z';

interface Offer {
  unitId: string;
  examTypeId: string;
}

describe('exam bookings on PostgreSQL', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildTestApp>['app'];
  let offer: Offer;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
    app = context.app;
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    const rows = await pool.query<{ unit_id: string; exam_type_id: string }>(
      `update unit_exam_offers o set capacity_per_slot = $1
       from units u, exam_types e
       where u.id = o.unit_id and e.id = o.exam_type_id and u.name = 'Unidade Central' and e.code = 'raio_x'
       returning o.unit_id, o.exam_type_id`,
      [CAPACITY],
    );
    const row = rows.rows[0];
    if (!row) throw new Error('Unidade Central does not offer raio_x');
    offer = { unitId: row.unit_id, examTypeId: row.exam_type_id };
  });

  afterEach(async () => {
    await pool.end();
  });

  const book = (token: string) =>
    request(app)
      .post('/api/exam-bookings')
      .set(as(token))
      .send({ ...offer, startsAt: STARTS_AT });

  it('gives a slot of capacity N to exactly N of N + 1 simultaneous patients, each on its own lane', async () => {
    const tokens = await Promise.all(
      Array.from({ length: CAPACITY + 1 }, (_, index) => signUp(app, `exame.${index}@email.com`)),
    );

    const responses = await Promise.all(tokens.map((token) => book(token)));

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([...Array<number>(CAPACITY).fill(201), 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'NO_CAPACITY' });
    const lanes = await pool.query<{ lane: number }>(
      "select lane from bookings where kind = 'exam' and status = 'confirmed' order by lane",
    );
    expect(lanes.rows.map(({ lane }) => lane)).toEqual([1, 2, 3]);
  });

  it('keeps two confirmed exams of the same offer off the same lane at overlapping times', async () => {
    const token = await signUp(app, 'raia@email.com');
    await book(token).expect(201);
    await signUp(app, 'outra.raia@email.com');
    const otherId = (await pool.query<{ id: string }>("select id from users where email = 'outra.raia@email.com'"))
      .rows[0]?.id;

    const insert = pool.query(
      `insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
       values ('exam', $1, $2, $3, 'EX-0VERAP', 1, '2026-11-23T13:05:00Z', '2026-11-23T13:20:00Z', 'confirmed')`,
      [otherId, offer.unitId, offer.examTypeId],
    );

    await expect(insert).rejects.toMatchObject({ code: '23P01', constraint: 'bookings_exam_lane_no_overlap_excl' });
  });
});
