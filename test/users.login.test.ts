import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildUsersApp, HOUR, login, registration, START } from './support/users.js';

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

  it('keeps at most 10 sessions per account, dropping the oldest', async () => {
    const { app, db, clock } = await withAccount();
    for (let attempt = 0; attempt < 11; attempt += 1) {
      clock.advance(60_000);
      await login(app).expect(200);
    }

    const total = await db.execute<{ total: number }>(sql`select count(*)::int as total from sessions`);

    expect(total.rows[0]?.total).toBe(10);
  });

  it('rejects a malformed body', async () => {
    const { app } = await withAccount();

    const response = await request(app).post('/api/users/login').send({ email: 'ana.silva@email.com' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { password: expect.any(String) as unknown },
    });
  });

  it('blocks an e-mail after 5 wrong passwords while other accounts keep working', async () => {
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
});
