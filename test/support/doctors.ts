import request from 'supertest';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { as, buildUsersApp, login, registerAndLogin } from './users.js';

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

export async function setupClinic() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(undefined);
  await context.modules.demo.service.seed();
  const patient = await registerAndLogin(context.app);
  const demo = DEMO_ACCOUNTS[0];
  const demoLogin = await login(context.app, { email: demo?.email, password: demo?.password }).expect(200);
  return { ...context, patient, demoPatient: (demoLogin.body as { token: string }).token };
}

export type Clinic = Awaited<ReturnType<typeof setupClinic>>;

export const listDoctors = (context: Clinic, token: string, query: Record<string, string | number> = {}) =>
  request(context.app).get('/api/doctors').query(query).set(as(token));

export const availability = (context: Clinic, token: string, id: string, query: Record<string, string>) =>
  request(context.app).get(`/api/doctors/${id}/availability`).query(query).set(as(token));

export async function doctorNamed(context: Clinic, fullName: string, token = context.demoPatient): Promise<Doctor> {
  const page = (await listDoctors(context, token, { search: fullName }).expect(200)).body as DoctorPage;
  const doctor = page.items.find((item) => item.fullName === fullName);
  if (!doctor) throw new Error(`${fullName} is not listed`);
  return doctor;
}
