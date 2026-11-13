import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '@/app.js';
import { createLogger } from '@/config/logger.js';
import { rateLimit } from 'express-rate-limit';
import { createRequireRole, createRequireWritable } from '@/middleware/auth.js';
import { rateLimitDefaults } from '@/middleware/rate-limit.js';
import { MailQueue } from '@/mail/index.js';
import { createModules } from '@/modules/index.js';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { TEST_CORS_ORIGIN } from './support/build-test-app.js';
import { createTestDb } from './support/create-test-db.js';
import { fixedClock } from './support/fixed-clock.js';
import { MemoryMailer } from './support/memory-mailer.js';
import { login, registration, START } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const demo = DEMO_ACCOUNTS[0];
if (!demo) throw new Error('A demo account is expected');

async function buildRolesApp() {
  const db = await createTestDb();
  const silent = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  const logger = createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }, silent);
  const modules = createModules({
    db,
    mail: new MailQueue(new MemoryMailer(), logger),
    clock: fixedClock(START),
    policy: { idleHours: 12, maxDays: 7, maxSessionsPerUser: 10 },
  });
  const probe = Router();
  const probeLimit = rateLimit({ ...rateLimitDefaults, windowMs: 60_000, limit: 100 });
  probe.get('/probe/admin', probeLimit, modules.users.requireAuth, createRequireRole('admin'), (_req, res) => {
    res.json({ ok: true });
  });
  probe.post('/probe/write', probeLimit, modules.users.requireAuth, createRequireWritable(), (_req, res) => {
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
  it('creates the admin as patient and admin, and the demo patient as a protected account', async () => {
    const { db, users } = await buildRolesApp();

    await users.bootstrap(ADMIN);

    const rows = await db.execute<{ email: string; is_protected: boolean; roles: string[] }>(sql`
      select email, is_protected, array(select role from user_roles where user_id = users.id order by role) as roles
      from users order by email
    `);
    expect(rows.rows).toEqual([
      { email: ADMIN.email, is_protected: false, roles: ['admin', 'patient'] },
      { email: demo.email, is_protected: true, roles: ['patient'] },
    ]);
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

  it('refuses to start when the demo e-mail belongs to a regular account', async () => {
    const { app, users } = await buildRolesApp();
    await request(app)
      .post('/api/users/register')
      .send(registration({ email: demo.email }))
      .expect(201);

    await expect(users.bootstrap(undefined)).rejects.toThrow(/different protection/);
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
    expect(rows.rows[0]).toEqual({ total: 2, roles: ['admin', 'patient'] });
  });

  it('skips the admin when none is configured', async () => {
    const { db, users } = await buildRolesApp();

    await users.bootstrap(undefined);

    const rows = await db.execute<{ email: string }>(sql`select email from users`);
    expect(rows.rows).toEqual([{ email: demo.email }]);
  });
});

describe('protected demo account', () => {
  it('keeps more than 10 sessions, since many visitors share it, but never remembers them', async () => {
    const { app, db, users } = await buildRolesApp();
    await users.bootstrap(undefined);
    let expiresAt = '';
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await login(app, { email: demo.email, password: demo.password, remember: true }).expect(200);
      expiresAt = (response.body as { expiresAt: string }).expiresAt;
    }

    const total = await db.execute<{ total: number }>(sql`select count(*)::int as total from sessions`);

    expect(total.rows[0]?.total).toBe(11);
    expect(expiresAt).toBe(new Date(START.getTime() + 12 * 3_600_000).toISOString());
  });

  it('cannot change anything', async () => {
    const { app, users } = await buildRolesApp();
    await users.bootstrap(undefined);
    const token = await tokenOf(app, demo.email, demo.password);

    const response = await request(app).post('/probe/write').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'PROTECTED_ACCOUNT' });
  });

  it('lets regular accounts change their data', async () => {
    const { app } = await buildRolesApp();
    await request(app).post('/api/users/register').send(registration()).expect(201);
    const token = await tokenOf(app, 'ana.silva@email.com', 'senha-segura-123');

    expect((await request(app).post('/probe/write').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });
});
