import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildUsersApp, HOUR, registerAndLogin } from './support/users.js';

type App = Parameters<typeof request>[0];

const logout = (app: App, token?: string) => {
  const call = request(app).post('/api/users/logout');
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};

describe('POST /api/users/logout', () => {
  it('ends the session, after which the token no longer works', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    expect((await logout(app, token)).status).toBe(204);
    const again = await logout(app, token);

    expect(again.status).toBe(401);
    expect(again.body).toEqual({
      message: 'Sua sessão expirou. Entre novamente.',
      code: 'UNAUTHENTICATED',
    });
  });

  it.each([
    ['no Authorization header', undefined],
    ['a malformed token', 'not-a-token'],
    ['an unknown token', 'A'.repeat(43)],
  ])('refuses %s', async (_case, token) => {
    const { app } = await buildUsersApp();

    expect((await logout(app, token)).status).toBe(401);
  });

  it('ends only the session that asked', async () => {
    const { app, auth } = await buildUsersApp();
    const first = await registerAndLogin(app);
    const second = (
      await request(app).post('/api/users/login').send({ email: 'ana.silva@email.com', password: 'senha-segura-123' })
    ).body as { token: string };

    await logout(app, first).expect(204);

    expect(await auth.authenticate(second.token)).not.toBeNull();
  });
});

describe('session validity', () => {
  it('expires after 12 hours without use', async () => {
    const { app, clock, auth } = await buildUsersApp();
    const token = await registerAndLogin(app);

    clock.advance(12 * HOUR - 60_000);
    expect(await auth.authenticate(token)).not.toBeNull();
  });

  it('is refused once the 12 hours pass without use', async () => {
    const { app, clock, auth } = await buildUsersApp();
    const token = await registerAndLogin(app);

    clock.advance(12 * HOUR);

    expect(await auth.authenticate(token)).toBeNull();
  });

  it('slides the 12-hour window while in use, but never past 7 days', async () => {
    const { app, clock, auth } = await buildUsersApp();
    const token = await registerAndLogin(app);

    for (let elapsed = 0; elapsed < 7 * 24 - 10; elapsed += 10) {
      clock.advance(10 * HOUR);
      expect(await auth.authenticate(token), `after ${elapsed + 10} hours`).not.toBeNull();
    }
    clock.advance(10 * HOUR);

    expect(await auth.authenticate(token)).toBeNull();
  });

  it('keeps a remembered session for 7 days without use, and not longer', async () => {
    const { app, clock, auth } = await buildUsersApp();
    const token = await registerAndLogin(app, { remember: true });

    clock.advance(7 * 24 * HOUR - 60_000);
    expect(await auth.authenticate(token)).not.toBeNull();
    clock.advance(60_000);

    expect(await auth.authenticate(token)).toBeNull();
  });

  it('refuses the session of a deactivated account', async () => {
    const { app, db, auth } = await buildUsersApp();
    const token = await registerAndLogin(app);

    await db.execute(sql`update users set deactivated_at = now()`);

    expect(await auth.authenticate(token)).toBeNull();
  });
});
