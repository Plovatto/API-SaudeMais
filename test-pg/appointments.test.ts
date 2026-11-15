import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { DEMO_ACCOUNTS, DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { as, HOUR, signUp, START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

interface Doctor {
  id: string;
  specialty_id: string;
}

describe('appointments on PostgreSQL', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildTestApp>['app'];
  let context: ReturnType<typeof buildTestApp>;
  let carlos: Doctor;
  let ana: Doctor;
  let demoDoctor: Doctor;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
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
    demoDoctor = named(DEMO_DOCTOR.fullName);
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

  it('cancels a booking only once when two cancellations race', async () => {
    const patient = await signUp(app, 'cancela@email.com');
    const booked = (await book(patient, carlos, '2026-11-23T11:00:00.000Z').expect(201)).body as { id: string };
    const cancel = () =>
      request(app)
        .post(`/api/appointments/${booked.id}/cancel`)
        .set(as(patient))
        .send({ startsAt: '2026-11-23T11:00:00.000Z' });

    const responses = await Promise.all([cancel(), cancel()]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'INVALID_STATE' });
    const events = await pool.query<{ total: number }>(
      "select count(*)::int as total from booking_events where booking_id = $1 and event_type = 'cancelled'",
      [booked.id],
    );
    expect(events.rows[0]?.total).toBe(1);
  });

  async function demoBooking() {
    const signIn = async ({ email, password }: { email: string; password: string }) =>
      ((await request(app).post('/api/users/login').send({ email, password }).expect(200)).body as { token: string })
        .token;
    const demoPatient = DEMO_ACCOUNTS.find((account) => account.roles.includes('patient'));
    if (!demoPatient) throw new Error('The demo patient is not configured');
    const [patient, doctor] = await Promise.all([signIn(demoPatient), signIn(DEMO_DOCTOR)]);
    const startsAt = '2026-11-23T11:00:00.000Z';
    const { id } = (await book(patient, demoDoctor, startsAt).expect(201)).body as { id: string };
    const act = (action: string, token: string, seen = startsAt) =>
      request(app).post(`/api/appointments/${id}/${action}`).set(as(token)).send({ startsAt: seen });
    const events = async () =>
      (
        await pool.query<{ event_type: string }>(
          "select event_type from booking_events where booking_id = $1 and event_type <> 'created' order by created_at, id",
          [id],
        )
      ).rows.map((row) => row.event_type);
    return { id, startsAt, patient, doctor, act, events };
  }

  it('confirms a request only once when two confirmations race', async () => {
    const { doctor, act, events } = await demoBooking();

    const responses = await Promise.all([act('confirm', doctor), act('confirm', doctor)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'INVALID_STATE' });
    expect(await events()).toEqual(['confirmed']);
  });

  it('keeps the patient cancellation when a confirmation races it', async () => {
    const { patient, doctor, act, events } = await demoBooking();

    const [confirmed, cancelled] = await Promise.all([act('confirm', doctor), act('cancel', patient)]);

    expect(cancelled.status).toBe(200);
    expect([200, 409]).toContain(confirmed.status);
    expect(await events()).toEqual(confirmed.status === 200 ? ['confirmed', 'cancelled'] : ['cancelled']);
    const status = await pool.query<{ status: string }>('select status from bookings');
    expect(status.rows.map((row) => row.status)).toEqual(['cancelled']);
  });

  async function startedBooking() {
    const booking = await demoBooking();
    await booking.act('confirm', booking.doctor).expect(200);
    const startsAt = new Date(Date.parse(booking.startsAt) - 96 * HOUR).toISOString();
    await pool.query(
      'update bookings set starts_at = $2, ends_at = $2::timestamptz + (ends_at - starts_at) where id = $1',
      [booking.id, startsAt],
    );
    return { ...booking, startsAt };
  }

  it('records only one outcome when a completion and a no-show race', async () => {
    const { doctor, act, events, startsAt } = await startedBooking();

    const responses = await Promise.all([act('complete', doctor, startsAt), act('no-show', doctor, startsAt)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({ code: 'INVALID_STATE' });
    const winner = responses.find((response) => response.status === 200)?.body as { status: string };
    expect(await events()).toEqual(['confirmed', winner.status]);
  });

  it('keeps the completion when a patient cancellation races it after the start', async () => {
    const { patient, doctor, act, events, startsAt } = await startedBooking();

    const [completed, cancelled] = await Promise.all([
      act('complete', doctor, startsAt),
      act('cancel', patient, startsAt),
    ]);

    expect(completed.status).toBe(200);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body).toMatchObject({ code: 'INVALID_STATE' });
    expect(await events()).toEqual(['confirmed', 'completed']);
  });

  it('serves the doctor agenda tabs and home from PostgreSQL', async () => {
    const { doctor, act } = await demoBooking();
    await act('confirm', doctor).expect(200);
    const get = (path: string) => request(app).get(path).set(as(doctor)).expect(200);

    const tabs = await Promise.all(
      ['pending', 'confirmed', 'awaiting', 'history'].map((tab) =>
        get(`/api/doctor/appointments?tab=${tab}&from=2026-11-23`),
      ),
    );
    const home = (await get('/api/doctor/home')).body as Record<string, unknown>;

    expect(tabs.map((response) => (response.body as { total: number }).total)).toEqual([0, 1, 0, 0]);
    expect(tabs[1]?.body).toMatchObject({
      counts: { pending: 0, confirmed: 1, awaiting: 0, history: 0 },
      items: [
        {
          status: 'confirmed',
          actions: { canConfirm: false, canCancel: true, canComplete: false, canNoShow: false },
        },
      ],
    });
    expect(home).toMatchObject({
      today: { date: '2026-11-20', total: 0 },
      pending: [],
      awaitingRecord: [],
      counts: { pending: 0, confirmed: 1, awaiting: 0, history: 0 },
      lastNotification: { type: 'appointment_requested' },
    });
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

  it('keeps an exam from overlapping an appointment of the same patient', async () => {
    const token = await signUp(app, 'mesmo@email.com');
    await book(token, carlos, '2026-11-23T11:00:00.000Z').expect(201);
    const offer = await pool.query<{ unit_id: string; exam_type_id: string }>(
      'select unit_id, exam_type_id from unit_exam_offers limit 1',
    );

    await expect(
      pool.query(
        `insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
         select 'exam', id, $1, $2, 'EX-7F3K2Q', 1, '2026-11-23T11:15:00Z', '2026-11-23T11:35:00Z', 'confirmed'
         from users where email = 'mesmo@email.com'`,
        [offer.rows[0]?.unit_id, offer.rows[0]?.exam_type_id],
      ),
    ).rejects.toMatchObject({ code: '23P01', constraint: 'bookings_patient_no_overlap_excl' });
  });

  it('never leaves an active appointment with a doctor deactivated at the same time', async () => {
    await context.modules.users.bootstrap(ADMIN);
    const admin = (await request(app).post('/api/users/login').send(ADMIN).expect(200)).body as { token: string };
    const patients = await Promise.all([signUp(app, 'corrida1@email.com'), signUp(app, 'corrida2@email.com')]);

    const responses = await Promise.all([
      book(patients[0] ?? '', carlos, '2026-11-23T11:00:00.000Z'),
      request(app).post(`/api/admin/users/${carlos.id}/deactivate`).set(as(admin.token)),
      book(patients[1] ?? '', carlos, '2026-11-23T11:30:00.000Z'),
    ]);

    expect(responses[1]?.status).toBe(200);
    for (const response of [responses[0], responses[2]]) expect([201, 404]).toContain(response?.status);
    const active = await pool.query<{ total: number }>(
      "select count(*)::int as total from bookings where doctor_id = $1 and status in ('pending', 'confirmed')",
      [carlos.id],
    );
    expect(active.rows[0]?.total).toBe(0);
  });
});
