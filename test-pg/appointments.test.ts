import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { as, signUp, START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

interface Doctor {
  id: string;
  specialty_id: string;
}

describe('appointments on PostgreSQL', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildTestApp>['app'];
  let carlos: Doctor;
  let ana: Doctor;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
    app = context.app;
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    const doctors = await pool.query<Doctor & { full_name: string }>(
      'select u.id, u.full_name, p.specialty_id from users u join doctor_profiles p on p.user_id = u.id',
    );
    const named = (fullName: string) => {
      const doctor = doctors.rows.find((row) => row.full_name === fullName);
      if (!doctor) throw new Error(`${fullName} was not seeded`);
      return doctor;
    };
    carlos = named('Dr. Carlos Mendes');
    ana = named('Dra. Ana Ferreira');
  });

  afterEach(async () => {
    await pool.end();
  });

  const book = (token: string, doctor: Doctor, startsAt: string) =>
    request(app)
      .post('/api/appointments')
      .set(as(token))
      .send({ doctorId: doctor.id, specialtyId: doctor.specialty_id, visitType: 'first_visit', startsAt });

  const activeBookings = async () =>
    (
      await pool.query<{ total: number }>(
        "select count(*)::int as total from bookings where status in ('pending', 'confirmed')",
      )
    ).rows[0]?.total;

  it('gives a slot to only one of two simultaneous requests', async () => {
    const first = await signUp(app, 'primeira@email.com');
    const second = await signUp(app, 'segunda@email.com');

    const responses = await Promise.all([
      book(first, carlos, '2026-11-23T11:00:00.000Z'),
      book(second, carlos, '2026-11-23T11:00:00.000Z'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'SLOT_TAKEN' });
    expect(await activeBookings()).toBe(1);
  });

  it('keeps a patient from holding two overlapping bookings with different doctors', async () => {
    const patient = await signUp(app, 'paciente@email.com');

    const responses = await Promise.all([
      book(patient, carlos, '2026-11-23T11:30:00.000Z'),
      book(patient, ana, '2026-11-23T11:40:00.000Z'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'PATIENT_CONFLICT' });
    expect(await activeBookings()).toBe(1);
  });

  it('keeps two confirmed exams out of the same lane at the same time', async () => {
    await signUp(app, 'exame1@email.com');
    await signUp(app, 'exame2@email.com');
    const patients = await pool.query<{ id: string }>('select id from users where email in ($1, $2) order by email', [
      'exame1@email.com',
      'exame2@email.com',
    ]);
    const offer = await pool.query<{ unit_id: string; exam_type_id: string }>(
      'select unit_id, exam_type_id from unit_exam_offers limit 1',
    );
    const insertExam = (patientId: string | undefined, code: string, lane: number) =>
      pool.query(
        `insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
         values ('exam', $1, $2, $3, $4, $5, '2026-11-23T12:00:00Z', '2026-11-23T12:20:00Z', 'confirmed')`,
        [patientId, offer.rows[0]?.unit_id, offer.rows[0]?.exam_type_id, code, lane],
      );

    await insertExam(patients.rows[0]?.id, 'EX-7F3K2Q', 1);
    await expect(insertExam(patients.rows[1]?.id, 'EX-8G4M3R', 1)).rejects.toMatchObject({
      code: '23P01',
      constraint: 'bookings_exam_lane_no_overlap_excl',
    });
    await expect(insertExam(patients.rows[1]?.id, 'EX-8G4M3R', 2)).resolves.toBeDefined();
  });
});
