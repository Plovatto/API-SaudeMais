import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@/app.js';
import { createLogger } from '@/config/create-logger.js';
import { rateLimit } from 'express-rate-limit';
import { createRequireRole } from '@/middleware/auth.js';
import { rateLimitDefaults } from '@/middleware/rate-limit.js';
import { MailQueue } from '@/mail/index.js';
import { createModules } from '@/modules/index.js';
import { EXAMPLE_PATIENT } from '@/modules/users/user.seed.js';
import { TEST_CORS_ORIGIN } from './support/build-test-app.js';
import { createTestDb } from './support/create-test-db.js';
import { fixedClock } from './support/fixed-clock.js';
import { MemoryMailer } from './support/memory-mailer.js';
import { login, registration, START } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

async function buildRolesApp() {
  const db = await createTestDb();
  const silent = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }, silent);
  const modules = createModules({
    db,
    mail: new MailQueue(new MemoryMailer(), logger),
    appUrl: 'https://app.saudemais.test',
    clock: fixedClock(START),
    policy: { idleHours: 12, maxDays: 7, maxSessionsPerUser: 10 },
  });
  const probe = Router();
  const probeLimit = rateLimit({ ...rateLimitDefaults, windowMs: 60_000, limit: 100 });
  probe.get('/probe/admin', probeLimit, modules.users.requireAuth, createRequireRole('admin'), (_req, res) => {
    res.json({ ok: true });
  });
  const app = createApp({
    config: { NODE_ENV: 'test', CORS_ORIGIN: TEST_CORS_ORIGIN, TRUST_PROXY_HOPS: 0 },
    logger,
    routers: [...modules.routers, probe],
  });
  return { app, db, users: modules.users };
}

const tokenOf = async (app: Parameters<typeof login>[0], email: string, password: string) =>
  ((await login(app, { email, password }).expect(200)).body as { token: string }).token;

describe('role authorization', () => {
  it('refuses a request without a session', async () => {
    const { app } = await buildRolesApp();

    expect((await request(app).get('/probe/admin')).status).toBe(401);
  });

  it('refuses an account without the required role', async () => {
    const { app } = await buildRolesApp();
    await request(app).post('/api/users/register').send(registration()).expect(201);
    const token = await tokenOf(app, 'ana.silva@email.com', 'senha-segura-123');

    const response = await request(app).get('/probe/admin').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Você não tem acesso a esta área.', code: 'FORBIDDEN' });
  });

  it('lets the initial admin in', async () => {
    const { app, users } = await buildRolesApp();
    await users.bootstrap(ADMIN);
    const token = await tokenOf(app, ADMIN.email, ADMIN.password);

    const response = await request(app).get('/probe/admin').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });
});

describe('initial accounts', () => {
  it('creates only the admin, as patient and admin, at startup', async () => {
    const { db, users } = await buildRolesApp();

    await users.bootstrap(ADMIN);

    const rows = await db.execute<{ email: string; roles: string[] }>(sql`
      select email, array(select role from user_roles where user_id = users.id order by role) as roles
      from users order by email
    `);
    expect(rows.rows).toEqual([{ email: ADMIN.email, roles: ['admin', 'patient'] }]);
  });

  it('refuses to promote an existing account whose password does not match', async () => {
    const { app, db, users } = await buildRolesApp();
    await request(app)
      .post('/api/users/register')
      .send(registration({ email: ADMIN.email }))
      .expect(201);

    await expect(users.bootstrap(ADMIN)).rejects.toThrow(/password does not match/);
    const rows = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from user_roles where role = 'admin'`,
    );
    expect(rows.rows[0]?.total).toBe(0);
  });

  it('can run on every start without duplicating accounts, and promotes an existing account that proves its password', async () => {
    const { app, db, users } = await buildRolesApp();
    await request(app)
      .post('/api/users/register')
      .send(registration({ email: ADMIN.email, password: ADMIN.password, passwordConfirmation: ADMIN.password }))
      .expect(201);

    await users.bootstrap(ADMIN);
    await users.bootstrap(ADMIN);

    const rows = await db.execute<{ total: number; roles: string[] }>(sql`
      select count(*)::int as total,
        array(select role from user_roles join users u on u.id = user_id where u.email = ${ADMIN.email} order by role) as roles
      from users
    `);
    expect(rows.rows[0]).toEqual({ total: 1, roles: ['admin', 'patient'] });
  });
});

describe('example account', () => {
  it('keeps at most 10 sessions and remembers them like any other account', async () => {
    const { app, db, users } = await buildRolesApp();
    await users.service.ensureAccount(EXAMPLE_PATIENT);
    let expiresAt = '';
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await login(app, {
        email: EXAMPLE_PATIENT.email,
        password: EXAMPLE_PATIENT.password,
        remember: true,
      }).expect(200);
      expiresAt = (response.body as { expiresAt: string }).expiresAt;
    }

    const total = await db.execute<{ total: number }>(sql`select count(*)::int as total from sessions`);

    expect(total.rows[0]?.total).toBe(10);
    expect(expiresAt).toBe(new Date(START.getTime() + 7 * 24 * 3_600_000).toISOString());
  });
});
