import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { createModules } from '@/modules/index.js';
import { EXAMPLE_PATIENT } from '@/modules/seed/seed.data.js';
import { as, buildUsersApp, login, registerAndLogin, signUp } from './users.js';

export interface Doctor {
  id: string;
  fullName: string;
  specialty: { id: string; name: string; council: string };
  unit: { id: string; name: string; address: string; phone: string };
  registry: { number: string; uf: string };
}

export interface DoctorPage {
  items: Doctor[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Availability {
  days: { date: string; slots: { startsAt: string; endsAt: string }[] }[];
}

export async function seedWithoutSampleBookings(modules: Pick<ReturnType<typeof createModules>, 'users' | 'seed'>) {
  await modules.users.service.ensureAccount(EXAMPLE_PATIENT);
  await modules.seed.service.seed();
}

export async function setupClinic() {
  const context = await buildUsersApp();
  await seedWithoutSampleBookings(context.modules);
  const patient = await registerAndLogin(context.app);
  const exampleLogin = await login(context.app, {
    email: EXAMPLE_PATIENT.email,
    password: EXAMPLE_PATIENT.password,
  }).expect(200);
  return { ...context, patient, examplePatient: (exampleLogin.body as { token: string }).token };
}

export type Clinic = Awaited<ReturnType<typeof setupClinic>>;

export const listDoctors = (context: Clinic, token: string, query: Record<string, string | number> = {}) =>
  request(context.app).get('/api/doctors').query(query).set(as(token));

export const availability = (context: Clinic, token: string, id: string, query: Record<string, string>) =>
  request(context.app).get(`/api/doctors/${id}/availability`).query(query).set(as(token));

export async function doctorNamed(context: Clinic, fullName: string, token = context.examplePatient): Promise<Doctor> {
  const page = (await listDoctors(context, token, { search: fullName }).expect(200)).body as DoctorPage;
  const doctor = page.items.find((item) => item.fullName === fullName);
  if (!doctor) throw new Error(`${fullName} is not listed`);
  return doctor;
}

export async function createDoctor(context: Clinic, email: string, fullName: string, registryNumber: string) {
  const token = await signUp(context.app, email, fullName);
  const rows = await context.db.execute<{ id: string }>(sql`
    insert into doctor_profiles (user_id, specialty_id, council, unit_id, registry_number, registry_uf)
    select u.id, p.specialty_id, p.council, p.unit_id, ${registryNumber}, 'SP'
    from users u, doctor_profiles p join users d on d.id = p.user_id
    where u.email = ${email} and d.full_name = 'Dr. Carlos Mendes'
    returning user_id as id
  `);
  const id = rows.rows[0]?.id ?? '';
  await context.db.execute(sql`insert into user_roles (user_id, role) values (${id}, 'doctor')`);
  await context.modules.doctorSchedule.service.ensureDefault(id);
  return { token, doctor: await doctorNamed(context, fullName) };
}
