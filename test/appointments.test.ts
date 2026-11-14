import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import {
  availability,
  doctorNamed,
  setupClinic,
  type Availability,
  type Clinic,
  type Doctor,
} from './support/doctors.js';
import { as, HOUR, login, signUp, START } from './support/users.js';

interface Appointment {
  id: string;
  status: string;
  visitType: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  patient: { id: string; fullName: string };
  doctor: { id: string; fullName: string };
  specialty: { id: string; name: string; council: string };
  unit: { id: string; name: string; address: string; phone: string };
  createdAt: string;
  events: Record<string, unknown>[];
}

const UNKNOWN_ID = '0190a5d2-6b7e-7c3a-9f1e-2d4c6b8a0e13';
const MONDAY_FIRST_SLOT = '2026-11-23T11:00:00.000Z';

let context: Clinic;
let carlos: Doctor;
let ana: Doctor;
let demoDoctor: Doctor;
let admin: string;

beforeAll(async () => {
  context = await setupClinic();
  carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
  ana = await doctorNamed(context, 'Dra. Ana Ferreira');
  demoDoctor = await doctorNamed(context, DEMO_DOCTOR.fullName);
  admin = await signUp(context.app, 'admin.teste@email.com');
  await context.db.execute(sql`
    update user_roles set role = 'admin'
    where role = 'patient' and user_id = (select id from users where email = 'admin.teste@email.com')
  `);
}, 60_000);

const appointment = (doctor: Doctor, startsAt: string, overrides: Record<string, unknown> = {}) => ({
  doctorId: doctor.id,
  specialtyId: doctor.specialty.id,
  visitType: 'first_visit',
  startsAt,
  ...overrides,
});

const book = (token: string, body: Record<string, unknown>) =>
  request(context.app).post('/api/appointments').set(as(token)).send(body);

const show = (token: string, id: string) => request(context.app).get(`/api/appointments/${id}`).set(as(token));

const slot = (date: string, time: string) => `${date}T${time}:00.000Z`;

describe('appointment routes', () => {
  it('require a session and the right role', async () => {
    expect((await request(context.app).post('/api/appointments').send({})).status).toBe(401);
    expect((await request(context.app).get(`/api/appointments/${UNKNOWN_ID}`)).status).toBe(401);

    const booked = await book(admin, appointment(carlos, MONDAY_FIRST_SLOT));
    const shown = await show(admin, UNKNOWN_ID);

    expect(booked.status).toBe(403);
    expect(booked.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(shown.status).toBe(403);
  });
});

describe('POST /api/appointments', () => {
  it('creates a pending request on a free slot and returns its detail', async () => {
    const response = await book(
      context.patient,
      appointment(carlos, MONDAY_FIRST_SLOT, { visitType: 'routine', notes: '  Dor no peito ao subir escadas.  ' }),
    );

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      id: expect.any(String) as unknown,
      status: 'pending',
      visitType: 'routine',
      startsAt: MONDAY_FIRST_SLOT,
      endsAt: '2026-11-23T11:30:00.000Z',
      notes: 'Dor no peito ao subir escadas.',
      patient: { id: expect.any(String) as unknown, fullName: 'Ana Maria Silva' },
      doctor: { id: carlos.id, fullName: 'Dr. Carlos Mendes' },
      specialty: carlos.specialty,
      unit: carlos.unit,
      createdAt: START.toISOString(),
      events: [
        {
          type: 'created',
          actorType: 'patient',
          fromStatus: null,
          toStatus: 'pending',
          fromStartsAt: null,
          toStartsAt: null,
          createdAt: START.toISOString(),
        },
      ],
    });
  });

  it('notifies the doctor after commit and hides the slot from the availability', async () => {
    const patient = await signUp(context.app, 'notifica@email.com');
    const area = { userId: carlos.id, role: 'doctor' as const };
    const before = await context.modules.notifications.service.unreadCount(area);

    const created = (await book(patient, appointment(carlos, slot('2026-11-24', '11:00'))).expect(201))
      .body as Appointment;
    const rows = await context.db.execute<{ user_id: string; audience_role: string; type: string; params: unknown }>(
      sql`select user_id, audience_role, type, params from notifications where booking_id = ${created.id}`,
    );
    const days = (
      (await availability(context, patient, carlos.id, { from: '2026-11-24', to: '2026-11-24' }).expect(200))
        .body as Availability
    ).days;

    expect(rows.rows).toEqual([
      {
        user_id: carlos.id,
        audience_role: 'doctor',
        type: 'appointment_requested',
        params: { startsAt: '2026-11-24T11:00:00.000Z' },
      },
    ]);
    expect(await context.modules.notifications.service.unreadCount(area)).toBe(before + 1);
    expect(days[0]?.slots).toHaveLength(15);
    expect(days[0]?.slots[0]?.startsAt).toBe('2026-11-24T11:30:00.000Z');
  });

  it('answers 409 SLOT_TAKEN when the doctor is already booked', async () => {
    const first = await signUp(context.app, 'primeira@email.com');
    const second = await signUp(context.app, 'segunda@email.com');
    await book(first, appointment(carlos, slot('2026-11-25', '13:00'))).expect(201);

    const response = await book(second, appointment(carlos, slot('2026-11-25', '13:00')));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Este horário acabou de ser ocupado. Escolha outra vaga.',
      code: 'SLOT_TAKEN',
      fields: { startsAt: 'Este horário acabou de ser ocupado. Escolha outra vaga.' },
    });
  });

  it('answers 409 PATIENT_CONFLICT when the patient already has an overlapping booking', async () => {
    const patient = await signUp(context.app, 'conflito@email.com');
    await book(patient, appointment(carlos, slot('2026-11-26', '11:30'))).expect(201);

    const response = await book(patient, appointment(ana, slot('2026-11-26', '11:40'), { visitType: 'follow_up' }));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'PATIENT_CONFLICT',
      fields: { startsAt: expect.any(String) as unknown },
    });
  });

  it('answers 422 OUTSIDE_AVAILABILITY for times that are not generated slots', async () => {
    const outside = [
      slot('2026-11-23', '11:10'),
      slot('2026-11-19', '13:00'),
      slot('2026-11-22', '11:00'),
      slot('2026-11-23', '15:00'),
      slot('2027-01-25', '11:00'),
      '2026-11-20T12:30:00.000Z',
    ];

    for (const startsAt of outside) {
      const response = await book(context.patient, appointment(carlos, startsAt));
      expect(response.status, startsAt).toBe(422);
      expect(response.body).toMatchObject({ code: 'OUTSIDE_AVAILABILITY' });
    }
  });

  it('accepts the slot start with a São Paulo offset', async () => {
    const patient = await signUp(context.app, 'offset@email.com');

    const response = await book(patient, appointment(carlos, '2026-11-27T08:00:00-03:00'));

    expect(response.status).toBe(201);
    expect((response.body as Appointment).startsAt).toBe('2026-11-27T11:00:00.000Z');
  });

  it('answers 422 SPECIALTY_MISMATCH when the doctor does not have the specialty', async () => {
    const response = await book(
      context.patient,
      appointment(carlos, slot('2026-11-27', '16:00'), { specialtyId: ana.specialty.id }),
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'SPECIALTY_MISMATCH',
      fields: { specialtyId: expect.any(String) as unknown },
    });
  });

  it('answers 422 ACTIVE_LIMIT on the sixth active future booking of a regular account', async () => {
    const patient = await signUp(context.app, 'limite@email.com');
    const times = ['11:30', '12:00', '12:30', '13:00', '13:30'];
    for (const time of times) await book(patient, appointment(carlos, slot('2026-12-01', time))).expect(201);

    const response = await book(patient, appointment(carlos, slot('2026-12-01', '14:00')));

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'ACTIVE_LIMIT' });
  });

  it('lets protected patients book the demo doctor without the active limit', async () => {
    const times = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30'];

    for (const time of times) {
      await book(context.demoPatient, appointment(demoDoctor, slot('2026-12-02', time))).expect(201);
    }
  });

  it('hides the demo doctor and unknown doctors from regular patients with 404', async () => {
    const hidden = await book(context.patient, appointment(demoDoctor, slot('2026-12-03', '11:00')));
    const unknown = await book(
      context.patient,
      appointment(carlos, slot('2026-12-03', '11:00'), { doctorId: UNKNOWN_ID }),
    );

    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual({ message: 'Médico não encontrado.', code: 'NOT_FOUND' });
    expect(unknown.status).toBe(404);
  });

  it('answers 422 SELF_BOOKING when the doctor books with himself', async () => {
    const doctor = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password }).expect(200);

    const response = await book(
      (doctor.body as { token: string }).token,
      appointment(demoDoctor, slot('2026-12-03', '11:00')),
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'SELF_BOOKING', fields: { doctorId: expect.any(String) as unknown } });
  });

  it('rejects invalid bodies with 400', async () => {
    const valid = appointment(carlos, slot('2026-12-04', '11:00'));
    const invalid = [
      {},
      { ...valid, doctorId: 'abc' },
      { ...valid, specialtyId: undefined },
      { ...valid, visitType: 'emergency' },
      { ...valid, startsAt: '2026-12-04 11:00' },
      { ...valid, notes: 'a'.repeat(501) },
      { ...valid, notes: 'linha\u0000nula' },
      { ...valid, extra: true },
    ];

    for (const body of invalid) {
      const response = await book(context.patient, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

describe('GET /api/appointments/:id', () => {
  it('shows the appointment to its patient and its doctor only', async () => {
    const created = (
      await book(
        context.demoPatient,
        appointment(demoDoctor, slot('2026-12-07', '11:00'), { notes: 'Retorno anual.' }),
      ).expect(201)
    ).body as Appointment;
    const doctorLogin = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    const doctor = (doctorLogin.body as { token: string }).token;

    const asPatient = await show(context.demoPatient, created.id);
    const asDoctor = await show(doctor, created.id);
    const asStranger = await show(context.patient, created.id);

    expect(asPatient.status).toBe(200);
    expect(asPatient.headers['cache-control']).toBe('no-store');
    expect(asPatient.body).toEqual(created);
    expect(asDoctor.status).toBe(200);
    expect(asDoctor.body).toMatchObject({
      id: created.id,
      notes: 'Retorno anual.',
      patient: { fullName: 'Ana Maria Silva' },
    });
    expect(asStranger.status).toBe(404);
    expect(asStranger.body).toEqual({ message: 'Consulta não encontrada.', code: 'NOT_FOUND' });
    expect((await show(context.patient, UNKNOWN_ID)).status).toBe(404);
    expect((await show(context.patient, 'abc')).status).toBe(400);
  });

  it('reports a pending request whose time has come as expired', async () => {
    const patient = await signUp(context.app, 'expira@email.com');
    const created = (await book(patient, appointment(carlos, slot('2026-12-08', '11:00'))).expect(201))
      .body as Appointment;

    context.clock.advance(19 * 24 * HOUR);
    try {
      const later = (await login(context.app, { email: 'expira@email.com' }).expect(200)).body as { token: string };
      expect((await show(later.token, created.id)).body).toMatchObject({ status: 'expired' });
    } finally {
      context.clock.advance(-19 * 24 * HOUR);
    }
  });
});
