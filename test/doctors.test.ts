import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS, DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import { buildUsersApp, login, registerAndLogin, registration } from './support/users.js';

type Context = Awaited<ReturnType<typeof buildUsersApp>>;

interface Doctor {
  id: string;
  fullName: string;
  specialty: { id: string; name: string; council: string };
  unit: { id: string; name: string; address: string; phone: string };
  registry: { number: string; uf: string };
}

interface DoctorPage {
  items: Doctor[];
  page: number;
  pageSize: number;
  total: number;
}

interface Availability {
  days: { date: string; slots: { startsAt: string; endsAt: string }[] }[];
}

const SAMPLE_NAMES = ['Dr. Carlos Mendes', 'Dr. Rafael Costa', 'Dra. Ana Ferreira', 'Dra. Beatriz Lima'];
const UNKNOWN_ID = '0190a5d2-6b7e-7c3a-9f1e-2d4c6b8a0e13';
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function setup() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(undefined);
  await context.modules.demo.service.seed();
  const patient = await registerAndLogin(context.app);
  const demo = DEMO_ACCOUNTS[0];
  const demoLogin = await login(context.app, { email: demo?.email, password: demo?.password }).expect(200);
  return { ...context, patient, demoPatient: (demoLogin.body as { token: string }).token };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const list = (context: Context, token: string, query: Record<string, string | number> = {}) =>
  request(context.app).get('/api/doctors').query(query).set(as(token));

const availability = (context: Context, token: string, id: string, query: Record<string, string>) =>
  request(context.app).get(`/api/doctors/${id}/availability`).query(query).set(as(token));

async function doctorNamed(context: Setup, fullName: string, token = context.demoPatient): Promise<Doctor> {
  const page = (await list(context, token, { search: fullName }).expect(200)).body as DoctorPage;
  const doctor = page.items.find((item) => item.fullName === fullName);
  if (!doctor) throw new Error(`${fullName} is not listed`);
  return doctor;
}

const namesOf = (response: request.Response) => (response.body as DoctorPage).items.map((item) => item.fullName);

let context: Setup;

beforeAll(async () => {
  context = await setup();
}, 60_000);

describe('doctor routes', () => {
  it('require a session and the patient role', async () => {
    await request(context.app)
      .post('/api/users/register')
      .send(registration({ fullName: 'Paulo Souza', email: 'paulo@email.com' }))
      .expect(201);
    await context.db.execute(sql`
      update user_roles set role = 'admin'
      where role = 'patient' and user_id = (select id from users where email = 'paulo@email.com')
    `);
    const admin = ((await login(context.app, { email: 'paulo@email.com' })).body as { token: string }).token;
    const doctor = await doctorNamed(context, 'Dr. Carlos Mendes');
    const period = { from: '2026-11-23', to: '2026-11-23' };

    expect((await request(context.app).get('/api/doctors')).status).toBe(401);
    expect((await request(context.app).get(`/api/doctors/${doctor.id}/availability`).query(period)).status).toBe(401);
    expect((await list(context, admin)).body).toMatchObject({ code: 'FORBIDDEN' });
    expect((await list(context, admin)).status).toBe(403);
    expect((await availability(context, admin, doctor.id, period)).status).toBe(403);
  });
});

describe('GET /api/doctors', () => {
  it('lists active doctors with specialty, unit and registry', async () => {
    const response = await list(context, context.patient).expect(200);
    const page = response.body as DoctorPage;
    const carlos = page.items.find((item) => item.fullName === 'Dr. Carlos Mendes');

    expect(response.headers['cache-control']).toBe('no-store');
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 4 });
    expect(namesOf(response).toSorted()).toEqual(SAMPLE_NAMES);
    expect(carlos).toEqual({
      id: expect.any(String) as unknown,
      fullName: 'Dr. Carlos Mendes',
      specialty: { id: expect.any(String) as unknown, name: 'Cardiologia', council: 'CRM' },
      unit: {
        id: expect.any(String) as unknown,
        name: 'Unidade Central',
        address: 'Rua das Flores, 123 - Centro, São Paulo - SP',
        phone: '+551133334444',
      },
      registry: { number: '98321', uf: 'SP' },
    });
  });

  it('shows the demo doctor only to protected patients', async () => {
    const visitor = await list(context, context.patient, { search: 'joao' }).expect(200);
    const demo = await list(context, context.demoPatient).expect(200);

    expect((visitor.body as DoctorPage).total).toBe(0);
    expect(namesOf(demo).toSorted()).toEqual([...SAMPLE_NAMES, DEMO_DOCTOR.fullName].toSorted());
  });

  it('filters by specialty', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');

    const response = await list(context, context.patient, { specialtyId: carlos.specialty.id }).expect(200);

    expect(namesOf(response)).toEqual(['Dr. Carlos Mendes']);
  });

  it('searches the name ignoring accents and case, with wildcards escaped', async () => {
    expect(namesOf(await list(context, context.patient, { search: 'BEATRIZ' }).expect(200))).toEqual([
      'Dra. Beatriz Lima',
    ]);
    expect(namesOf(await list(context, context.demoPatient, { search: 'joao' }).expect(200))).toEqual([
      DEMO_DOCTOR.fullName,
    ]);
    expect(namesOf(await list(context, context.demoPatient, { search: 'JOÃO' }).expect(200))).toEqual([
      DEMO_DOCTOR.fullName,
    ]);
    expect(namesOf(await list(context, context.patient, { search: '%' }).expect(200))).toEqual([]);
    expect(namesOf(await list(context, context.patient, { search: 'Dr_' }).expect(200))).toEqual([]);
  });

  it('paginates', async () => {
    const first = (await list(context, context.patient, { pageSize: 3 }).expect(200)).body as DoctorPage;
    const second = (await list(context, context.patient, { pageSize: 3, page: 2 }).expect(200)).body as DoctorPage;

    expect(first.items).toHaveLength(3);
    expect(second).toMatchObject({ page: 2, pageSize: 3, total: 4 });
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((item) => item.fullName).toSorted()).toEqual(SAMPLE_NAMES);
  });

  it('rejects invalid filters', async () => {
    for (const query of [{ specialtyId: 'abc' }, { pageSize: 51 }, { search: 'a'.repeat(121) }, { role: 'doctor' }]) {
      const response = await list(context, context.patient, query);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

describe('GET /api/doctors/:id/availability', () => {
  it('returns only the days with free slots in São Paulo time', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');

    const response = await availability(context, context.patient, carlos.id, {
      from: '2026-11-20',
      to: '2026-11-23',
    }).expect(200);
    const { days } = response.body as Availability;

    expect(response.headers['cache-control']).toBe('no-store');
    expect(days.map((day) => day.date)).toEqual(['2026-11-20', '2026-11-23']);
    expect(days[0]?.slots).toHaveLength(12);
    expect(days[0]?.slots[0]).toEqual({ startsAt: '2026-11-20T13:00:00.000Z', endsAt: '2026-11-20T13:30:00.000Z' });
    expect(days[1]?.slots).toHaveLength(16);
    expect(days[1]?.slots[0]).toEqual({ startsAt: '2026-11-23T11:00:00.000Z', endsAt: '2026-11-23T11:30:00.000Z' });
    expect(days[1]?.slots.at(-1)).toEqual({ startsAt: '2026-11-23T19:30:00.000Z', endsAt: '2026-11-23T20:00:00.000Z' });
  });

  it('uses the appointment duration of the doctor specialty', async () => {
    const ana = await doctorNamed(context, 'Dra. Ana Ferreira');

    const response = await availability(context, context.patient, ana.id, { from: '2026-11-23', to: '2026-11-23' });
    const slots = (response.body as Availability).days[0]?.slots ?? [];

    expect(slots).toHaveLength(12);
    expect(slots.slice(0, 2).map((slot) => slot.startsAt)).toEqual([
      '2026-11-23T11:00:00.000Z',
      '2026-11-23T11:40:00.000Z',
    ]);
    expect(slots.at(-1)).toEqual({ startsAt: '2026-11-23T19:20:00.000Z', endsAt: '2026-11-23T20:00:00.000Z' });
  });

  it('stops at the booking horizon', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');

    const response = await availability(context, context.patient, carlos.id, { from: '2027-01-15', to: '2027-01-31' });
    const { days } = response.body as Availability;

    expect(days.at(-1)?.date).toBe('2027-01-19');
    expect(days.at(-1)?.slots.at(-1)?.startsAt).toBe('2027-01-19T12:00:00.000Z');
  });

  it('accepts up to 31 days and rejects invalid periods', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
    const rejected = [
      {},
      { from: '2026-11-20' },
      { from: '2026-13-01', to: '2026-13-02' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '20261120', to: '20261121' },
      { from: '2026-11-23', to: '2026-11-22' },
      { from: '2026-11-20', to: '2026-12-21' },
      { from: '2026-11-20', to: '2026-11-21', extra: 'x' },
    ];

    expect(
      (await availability(context, context.patient, carlos.id, { from: '2026-11-20', to: '2026-12-20' })).status,
    ).toBe(200);
    for (const query of rejected) {
      const response = await availability(context, context.patient, carlos.id, query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const invalidId = await availability(context, context.patient, 'abc', { from: '2026-11-20', to: '2026-11-21' });
    expect(invalidId.status).toBe(400);
  });

  it('answers 404 for unknown doctors and hides the demo doctor from visitors', async () => {
    const demoDoctor = await doctorNamed(context, DEMO_DOCTOR.fullName);
    const period = { from: '2026-11-23', to: '2026-11-23' };
    const patientId = ((await request(context.app).get('/api/me').set(as(context.patient))).body as { id: string }).id;

    const unknown = await availability(context, context.patient, UNKNOWN_ID, period);
    const hidden = await availability(context, context.patient, demoDoctor.id, period);
    const notDoctor = await availability(context, context.patient, patientId, period);
    const shown = await availability(context, context.demoPatient, demoDoctor.id, period);

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: 'Médico não encontrado.', code: 'NOT_FOUND' });
    expect(hidden.status).toBe(404);
    expect(notDoctor.status).toBe(404);
    expect(shown.status).toBe(200);
    expect((shown.body as Availability).days[0]?.slots).toHaveLength(16);
  });

  it('leaves out inactive days, deactivated doctors and inactive specialties', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
    const beatriz = await doctorNamed(context, 'Dra. Beatriz Lima');
    const rafael = await doctorNamed(context, 'Dr. Rafael Costa');
    const week = { from: '2026-11-23', to: '2026-11-27' };

    await context.db.execute(
      sql`update doctor_schedule_days set is_active = false where doctor_id = ${carlos.id} and weekday = 1`,
    );
    await context.db.execute(sql`update users set deactivated_at = now() where id = ${beatriz.id}`);
    await context.db.execute(sql`update specialties set is_active = false where id = ${rafael.specialty.id}`);

    const days = ((await availability(context, context.patient, carlos.id, week)).body as Availability).days;
    const listed = namesOf(await list(context, context.patient).expect(200));

    expect(days.map((day) => day.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect((await availability(context, context.patient, beatriz.id, week)).status).toBe(404);
    expect((await availability(context, context.patient, rafael.id, week)).status).toBe(404);
    expect(listed.toSorted()).toEqual(['Dr. Carlos Mendes', 'Dra. Ana Ferreira']);
  });
});
