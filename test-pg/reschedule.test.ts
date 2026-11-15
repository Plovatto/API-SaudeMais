import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { as, signUp, START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const TARGET = '2026-11-23T13:00:00.000Z';

interface Doctor {
  id: string;
  specialty_id: string;
}

describe('reschedules on PostgreSQL', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildTestApp>['app'];
  let carlos: Doctor;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
    app = context.app;
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    const doctors = await pool.query<Doctor>(
      `select u.id, p.specialty_id from users u join doctor_profiles p on p.user_id = u.id
       where u.full_name = 'Dr. Carlos Mendes'`,
    );
    const doctor = doctors.rows[0];
    if (!doctor) throw new Error('Dr. Carlos Mendes was not seeded');
    carlos = doctor;
  });

  afterEach(async () => {
    await pool.end();
  });

  const book = (token: string, startsAt: string) =>
    request(app)
      .post('/api/appointments')
      .set(as(token))
      .send({ doctorId: carlos.id, specialtyId: carlos.specialty_id, visitType: 'routine', startsAt });

  async function booked(email: string, startsAt: string) {
    const token = await signUp(app, email);
    const { id } = (await book(token, startsAt).expect(201)).body as { id: string };
    const reschedule = () =>
      request(app).post(`/api/appointments/${id}/reschedule`).set(as(token)).send({ startsAt, newStartsAt: TARGET });
    return { id, reschedule };
  }

  const activeStarts = async () =>
    (
      await pool.query<{ starts_at: Date }>(
        "select starts_at from bookings where status in ('pending', 'confirmed') order by starts_at",
      )
    ).rows.map((row) => row.starts_at.toISOString());

  it('moves only one of two bookings rescheduled into the same slot at once and keeps the other in place', async () => {
    const first = await booked('reagenda.um@email.com', '2026-11-23T11:00:00.000Z');
    const second = await booked('reagenda.dois@email.com', '2026-11-23T11:30:00.000Z');

    const responses = await Promise.all([first.reschedule(), second.reschedule()]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'SLOT_TAKEN' });
    const kept = responses[0]?.status === 200 ? '2026-11-23T11:30:00.000Z' : '2026-11-23T11:00:00.000Z';
    expect(await activeStarts()).toEqual([kept, TARGET]);
    const events = await pool.query<{ total: number }>(
      "select count(*)::int as total from booking_events where event_type = 'rescheduled'",
    );
    expect(events.rows[0]?.total).toBe(1);
  });

  it('gives the slot to only one of a reschedule and a new booking made at once', async () => {
    const moving = await booked('reagenda.disputa@email.com', '2026-11-23T11:00:00.000Z');
    const newcomer = await signUp(app, 'novo.pedido@email.com');

    const [rescheduled, created] = await Promise.all([moving.reschedule(), book(newcomer, TARGET)]);

    const starts = await activeStarts();
    if (rescheduled.status === 200) {
      expect(created.status).toBe(409);
      expect(created.body).toMatchObject({ code: 'SLOT_TAKEN' });
      expect(starts).toEqual([TARGET]);
    } else {
      expect(created.status).toBe(201);
      expect(rescheduled.status).toBe(409);
      expect(rescheduled.body).toMatchObject({
        code: 'SLOT_TAKEN',
        fields: { newStartsAt: expect.any(String) as unknown },
      });
      expect(starts).toEqual(['2026-11-23T11:00:00.000Z', TARGET]);
    }
  });
});
