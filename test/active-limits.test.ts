import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { doctorNamed, setupClinic, type Clinic, type Doctor } from './support/doctors.js';
import { offerOf, type Offer } from './support/exams.js';
import { as, createAdmin, createPatient } from './support/users.js';

const DEFAULT_POLICY = {
  appointmentLateWindowHours: 24,
  examLateWindowHours: 2,
  maxReschedules: 2,
  bookingHorizonDays: 60,
  minLeadMinutes: 60,
  maxActiveBookings: 5,
  maxActiveAppointments: 5,
  maxActiveExams: 5,
};

let context: Clinic;
let admin: string;
let carlos: Doctor;
let hemograma: Offer;

beforeAll(async () => {
  context = await setupClinic();
  admin = await createAdmin(context, 'admin.limites@email.com');
  carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
  hemograma = await offerOf(context, 'Unidade Central', 'hemograma');
}, 60_000);

const usePolicy = (overrides: Partial<typeof DEFAULT_POLICY>) =>
  request(context.app)
    .put('/api/admin/policy')
    .set(as(admin))
    .send({ ...DEFAULT_POLICY, ...overrides })
    .expect(200);

const at = (date: string, time: string) => `${date}T${time}:00.000Z`;

const bookAppointment = (token: string, startsAt: string) =>
  request(context.app)
    .post('/api/appointments')
    .set(as(token))
    .send({ doctorId: carlos.id, specialtyId: carlos.specialty.id, visitType: 'routine', startsAt });

const bookExam = (token: string, startsAt: string) =>
  request(context.app)
    .post('/api/exam-bookings')
    .set(as(token))
    .send({ ...hemograma, startsAt });

async function activeOf(email: string) {
  const rows = await context.db.execute<{ total: number }>(sql`
    select count(*)::int as total from bookings b join users u on u.id = b.patient_id
    where u.email = ${email} and b.status in ('pending', 'confirmed')
  `);
  return rows.rows[0]?.total ?? 0;
}

describe('active booking limits from the policy', () => {
  it('stops new appointments at a lower appointment limit while exams stay free', async () => {
    await usePolicy({ maxActiveAppointments: 2 });
    const patient = await createPatient(context, 'limite.consultas@email.com');
    await bookAppointment(patient, at('2026-12-01', '11:00')).expect(201);
    await bookAppointment(patient, at('2026-12-01', '11:30')).expect(201);

    const third = await bookAppointment(patient, at('2026-12-01', '12:00'));
    const exam = await bookExam(patient, at('2026-12-02', '14:00'));

    expect(third.status).toBe(422);
    expect(third.body).toEqual({
      message: 'Você já tem 2 consultas ativas. Cancele uma ou aguarde a data de uma delas para marcar outra.',
      code: 'ACTIVE_LIMIT',
      fields: {
        _root: 'Você já tem 2 consultas ativas. Cancele uma ou aguarde a data de uma delas para marcar outra.',
      },
    });
    expect(exam.status).toBe(201);
  });

  it('stops new exams at a lower exam limit while appointments stay free', async () => {
    await usePolicy({ maxActiveExams: 1 });
    const patient = await createPatient(context, 'limite.exames@email.com');
    await bookExam(patient, at('2026-12-03', '14:00')).expect(201);

    const second = await bookExam(patient, at('2026-12-03', '14:10'));
    const appointment = await bookAppointment(patient, at('2026-12-03', '11:00'));

    expect(second.status).toBe(422);
    expect(second.body).toMatchObject({
      code: 'ACTIVE_LIMIT',
      message: 'Você já tem 1 exame ativo. Cancele um ou aguarde a data de um deles para marcar outro.',
    });
    expect(appointment.status).toBe(201);
  });

  it('counts appointments and exams together against the total limit', async () => {
    await usePolicy({ maxActiveBookings: 2 });
    const patient = await createPatient(context, 'limite.total@email.com');
    await bookAppointment(patient, at('2026-12-04', '11:00')).expect(201);
    await bookExam(patient, at('2026-12-04', '14:00')).expect(201);

    const appointment = await bookAppointment(patient, at('2026-12-04', '11:30'));
    const exam = await bookExam(patient, at('2026-12-04', '14:10'));

    for (const response of [appointment, exam]) {
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        code: 'ACTIVE_LIMIT',
        message: 'Você já tem 2 agendamentos ativos. Cancele um ou aguarde a data de um deles para marcar outro.',
      });
    }
  });

  it('allows more bookings than the default once the admin raises the limits', async () => {
    await usePolicy({ maxActiveBookings: 7, maxActiveAppointments: 7 });
    const patient = await createPatient(context, 'limite.maior@email.com');
    const times = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'];

    for (const time of times) await bookAppointment(patient, at('2026-12-07', time)).expect(201);

    expect((await bookAppointment(patient, at('2026-12-07', '14:30'))).status).toBe(422);
  });

  it('keeps existing bookings when the admin lowers a limit below them and only blocks new ones', async () => {
    await usePolicy({});
    const patient = await createPatient(context, 'limite.reduzido@email.com');
    for (const time of ['11:00', '11:30', '12:00']) await bookAppointment(patient, at('2026-12-08', time)).expect(201);

    await usePolicy({ maxActiveAppointments: 1 });
    const blocked = await bookAppointment(patient, at('2026-12-08', '12:30'));

    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatchObject({ code: 'ACTIVE_LIMIT' });
    expect(await activeOf('limite.reduzido@email.com')).toBe(3);
  });

  it('applies the limits to the example patient too', async () => {
    await usePolicy({ maxActiveAppointments: 1 });
    await bookAppointment(context.examplePatient, at('2026-12-09', '11:00')).expect(201);

    const second = await bookAppointment(context.examplePatient, at('2026-12-09', '11:30'));

    expect(second.status).toBe(422);
    expect(second.body).toMatchObject({ code: 'ACTIVE_LIMIT' });
  });
});
