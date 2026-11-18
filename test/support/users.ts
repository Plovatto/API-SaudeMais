import { sql } from 'drizzle-orm';
import request from 'supertest';
import { expect } from 'vitest';
import type { Database } from '@/database/pg-client.js';
import { loginSchema, registerSchema } from '@/modules/users/user.model.js';
import type { UserService } from '@/modules/users/user.service.js';
import { buildTestApp } from './build-test-app.js';
import { createTestDb } from './create-test-db.js';
import { fixedClock } from './fixed-clock.js';

export const START = new Date('2026-11-20T12:00:00.000Z');
export const HOUR = 3_600_000;

export const as = (token: string) => ({ Authorization: `Bearer ${token}` });

export const anyText = expect.any(String) as unknown;

export async function buildUsersApp() {
  const db = await createTestDb();
  const clock = fixedClock(START);
  const { app, modules, mailer, mail } = buildTestApp({}, { db, clock });
  return { app, db, clock, modules, mailer, mail, auth: modules.users.service };
}

export function registration(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Ana Maria Silva',
    email: 'ana.silva@email.com',
    phone: '(11) 98765-4321',
    password: 'senha-segura-123',
    passwordConfirmation: 'senha-segura-123',
    acceptTerms: true,
    ...overrides,
  };
}

type App = Awaited<ReturnType<typeof buildUsersApp>>['app'];

export function login(app: App, body: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/users/login')
    .send({
      email: 'ana.silva@email.com',
      password: 'senha-segura-123',
      ...body,
    });
}

export async function registerAndLogin(
  app: App,
  body: Record<string, unknown> = {},
  account: Record<string, unknown> = {},
) {
  await request(app).post('/api/users/register').send(registration(account)).expect(201);
  const response = await login(app, { email: registration(account).email, ...body }).expect(200);
  return (response.body as { token: string }).token;
}

export function signUp(app: App, email: string, fullName = 'Paciente de Teste') {
  return registerAndLogin(app, {}, { email, fullName });
}

export async function createPatient({ auth }: { auth: UserService }, email: string) {
  await auth.register(registerSchema.parse(registration({ email })));
  const credentials = loginSchema.parse({ email, password: registration().password });
  return (await auth.login(credentials, { ip: null, userAgent: null })).token;
}

export async function createAdmin(context: { auth: UserService; db: Database }, email: string) {
  const token = await createPatient(context, email);
  await context.db.execute(sql`
    update user_roles set role = 'admin'
    where role = 'patient' and user_id = (select id from users where email = ${email})
  `);
  return token;
}
