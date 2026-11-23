import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './support/build-test-app.js';
import { createTestDb } from './support/create-test-db.js';
import { anyText, buildUsersApp, HOUR, login, registration, START } from './support/users.js';

async function withAccount() {
  const context = await buildUsersApp();
  await request(context.app).post('/api/users/register').send(registration()).expect(201);
  return context;
}

describe('POST /api/users/login', () => {
  it('returns a session token that expires after 12 hours without use', async () => {
    const { app } = await withAccount();

    const response = await login(app, { email: 'ANA.SILVA@email.com' });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown,
      expiresAt: new Date(START.getTime() + 12 * HOUR).toISOString(),
      user: { email: 'ana.silva@email.com', roles: ['patient'] },
    });
  });

  it('keeps a remembered session for 7 days', async () => {
    const { app } = await withAccount();

    const response = await login(app, { remember: true });

    expect(response.body).toMatchObject({
      expiresAt: new Date(START.getTime() + 7 * 24 * HOUR).toISOString(),
    });
  });

  it('stores only a hash of the token', async () => {
    const { app, db } = await withAccount();
    const { token } = (await login(app)).body as { token: string };

    const stored = await db.execute<{ token_hash: string }>(sql`select token_hash from sessions`);

    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.token_hash).not.toBe(token);
  });

  it('answers a wrong password and an unknown e-mail the same way', async () => {
    const { app } = await withAccount();

    const wrongPassword = await login(app, { password: 'senha-errada-123' });
    const unknownEmail = await login(app, { email: 'ninguem@email.com' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({
      message: 'E-mail ou senha incorretos.',
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('reports a deactivated account only to whoever knows the password', async () => {
    const { app, db } = await withAccount();
    await db.execute(sql`update users set deactivated_at = now()`);

    expect((await login(app, { password: 'senha-errada-123' })).status).toBe(401);
    const response = await login(app);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'USER_INACTIVE' });
  });

  it('keeps at most 10 sessions per account, never dropping the one just created', async () => {
    const { app, db, auth } = await withAccount();
    let token = '';
    for (let attempt = 0; attempt < 11; attempt += 1) {
      token = ((await login(app).expect(200)).body as { token: string }).token;
    }

    const total = await db.execute<{ total: number }>(sql`select count(*)::int as total from sessions`);

    expect(total.rows[0]?.total).toBe(10);
    expect(await auth.authenticate(token)).not.toBeNull();
  });

  it('removes expired sessions of the account at the next login', async () => {
    const { app, db, clock } = await withAccount();
    await login(app).expect(200);
    clock.advance(13 * HOUR);

    await login(app).expect(200);

    const total = await db.execute<{ total: number }>(sql`select count(*)::int as total from sessions`);
    expect(total.rows[0]?.total).toBe(1);
  });

  it('stores no address when the forwarded one is not a valid IP', async () => {
    const db = await createTestDb();
    const { app } = buildTestApp({ TRUST_PROXY_HOPS: 2 }, { db });
    await request(app).post('/api/users/register').send(registration()).expect(201);

    const response = await login(app).set('X-Forwarded-For', 'not-an-ip, 10.0.0.1');

    expect(response.status).toBe(200);
    const stored = await db.execute<{ ip: string | null }>(sql`select ip::text from sessions`);
    expect(stored.rows[0]?.ip).toBeNull();
  });

  it('rejects a malformed body', async () => {
    const { app } = await withAccount();

    const response = await request(app).post('/api/users/login').send({ email: 'ana.silva@email.com' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { password: anyText },
    });
  });

  it('blocks an e-mail after 5 wrong passwords from the same address while other accounts keep working', async () => {
    const { app } = await withAccount();
    await request(app)
      .post('/api/users/register')
      .send(registration({ email: 'bruno@email.com' }))
      .expect(201);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login(app, { password: 'senha-errada-123' }).expect(401);
    }

    const blocked = await login(app);
    const other = await login(app, { email: 'bruno@email.com' });

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(other.status).toBe(200);
  });

  it('keeps the owner signing in from a known address after wrong passwords from many others', async () => {
    const db = await createTestDb();
    const { app } = buildTestApp({ TRUST_PROXY_HOPS: 1 }, { db });
    await request(app).post('/api/users/register').send(registration()).expect(201);
    const from = (ip: string, body: Record<string, unknown> = {}) => login(app, body).set('X-Forwarded-For', ip);
    await from('198.51.100.1').expect(200);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await from(`203.0.113.${Math.floor(attempt / 5) + 1}`, { password: 'senha-errada-123' }).expect(401);
    }

    const stranger = await from('203.0.113.200');
    const owner = await from('198.51.100.1');

    expect(stranger.status).toBe(429);
    expect(owner.status).toBe(200);
  }, 60_000);

  it('counts only live sessions as a known address', async () => {
    const context = await withAccount();
    const credentials = { email: 'ana.silva@email.com', password: 'senha-segura-123', remember: false };
    await context.auth.login(credentials, { ip: '198.51.100.1', userAgent: null });

    const live = await context.auth.knownDevice('ana.silva@email.com', '198.51.100.1');
    const other = await context.auth.knownDevice('ana.silva@email.com', '198.51.100.2');
    context.clock.advance(12 * HOUR + 1);
    const expired = await context.auth.knownDevice('ana.silva@email.com', '198.51.100.1');

    expect([live, other, expired]).toEqual([true, false, false]);
  });
});
