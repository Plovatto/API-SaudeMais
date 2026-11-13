import request from 'supertest';
import { buildTestApp } from './build-test-app.js';
import { createTestDb } from './create-test-db.js';
import { fixedClock } from './fixed-clock.js';

export const START = new Date('2026-11-20T12:00:00.000Z');
export const HOUR = 3_600_000;

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

export async function registerAndLogin(app: App, body: Record<string, unknown> = {}) {
  await request(app).post('/api/users/register').send(registration()).expect(201);
  const response = await login(app, body);
  return (response.body as { token: string }).token;
}
