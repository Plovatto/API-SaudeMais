import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MINUTE } from '@/lib/time.js';
import { UserRepository } from '@/modules/users/user.repository.js';
import { as, buildUsersApp, HOUR, login, registerAndLogin, START } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const PASSWORD = 'senha-segura-123';

type Context = Awaited<ReturnType<typeof buildUsersApp>>;

const tokenOf = async (app: Context['app'], body: Record<string, unknown> = {}) =>
  ((await login(app, body).expect(200)).body as { token: string }).token;

async function withPatient() {
  const context = await buildUsersApp();
  const token = await registerAndLogin(context.app);
  const cached = await context.auth.authenticate(token);
  if (!cached) throw new Error('The new session should be valid');
  return { ...context, token, userId: cached.user.id };
}

async function withAdmin() {
  const context = await withPatient();
  await context.modules.users.bootstrap(ADMIN);
  const admin = await tokenOf(context.app, ADMIN);
  return { ...context, admin };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session cache', () => {
  it('validates a repeated token without querying the database', async () => {
    const { auth, token } = await withPatient();
    const lookups = vi.spyOn(UserRepository.prototype, 'findActiveSession');

    expect(await auth.authenticate(token)).not.toBeNull();
    expect(await auth.authenticate(token)).not.toBeNull();

    expect(lookups).not.toHaveBeenCalled();
  });

  it('reloads the session once the cache entry expires', async () => {
    const { auth, clock, token } = await withPatient();
    const lookups = vi.spyOn(UserRepository.prototype, 'findActiveSession');

    clock.advance(5 * MINUTE);
    await auth.authenticate(token);

    expect(lookups).toHaveBeenCalledOnce();
  });

  it('records use at most every 5 minutes, also from the cache, sliding the expiry', async () => {
    const { app, auth, clock, db } = await buildUsersApp();
    const token = await registerAndLogin(app);
    clock.advance(3 * MINUTE);
    const touches = vi.spyOn(UserRepository.prototype, 'touchSession');
    await auth.authenticate(token);
    expect(touches).not.toHaveBeenCalled();
    const lookups = vi.spyOn(UserRepository.prototype, 'findActiveSession');

    clock.advance(2 * MINUTE);
    await auth.authenticate(token);
    await auth.authenticate(token);

    const usedAt = new Date(START.getTime() + 5 * MINUTE);
    expect(lookups).not.toHaveBeenCalled();
    expect(touches).toHaveBeenCalledOnce();
    const stored = await db.execute<{ last_used_at: string; expires_at: string }>(
      sql`select last_used_at::text, expires_at::text from sessions`,
    );
    expect(stored.rows.map((row) => [new Date(row.last_used_at), new Date(row.expires_at)])).toEqual([
      [usedAt, new Date(usedAt.getTime() + 12 * HOUR)],
    ]);
  });

  it('enforces the absolute limit with the app clock on a cached session', async () => {
    const context = await buildUsersApp();
    const token = await registerAndLogin(context.app, { remember: true });
    context.clock.advance(7 * 24 * HOUR - MINUTE);
    expect(await context.auth.authenticate(token)).not.toBeNull();
    const lookups = vi.spyOn(UserRepository.prototype, 'findActiveSession');

    context.clock.advance(MINUTE);

    expect(await context.auth.authenticate(token)).toBeNull();
    expect(lookups).not.toHaveBeenCalled();
  });

  it('enforces the idle expiry with the app clock on a cached session', async () => {
    const context = await buildUsersApp();
    const token = await registerAndLogin(context.app);
    const soon = new Date(START.getTime() + 3 * MINUTE);
    await context.db.execute(sql`update sessions set expires_at = ${soon}`);
    expect(await context.auth.authenticate(token)).not.toBeNull();
    const lookups = vi.spyOn(UserRepository.prototype, 'findActiveSession');

    context.clock.advance(3 * MINUTE);

    expect(await context.auth.authenticate(token)).toBeNull();
    expect(lookups).not.toHaveBeenCalled();
  });
});

describe('session cache invalidation', () => {
  it('drops the session on logout', async () => {
    const { app, auth, token } = await withPatient();

    await request(app).post('/api/users/logout').set(as(token)).expect(204);

    expect(await auth.authenticate(token)).toBeNull();
  });

  it('drops every session when signing out everywhere', async () => {
    const { app, auth, token } = await withPatient();
    const other = await tokenOf(app);
    await auth.authenticate(other);

    await request(app).delete('/api/me/sessions').set(as(token)).expect(204);

    expect(await auth.authenticate(token)).toBeNull();
    expect(await auth.authenticate(other)).toBeNull();
  });

  it('drops the other sessions on a password change and keeps the current one', async () => {
    const { app, auth, token } = await withPatient();
    const other = await tokenOf(app);
    await auth.authenticate(other);

    await request(app)
      .post('/api/me/password')
      .set(as(token))
      .send({ currentPassword: PASSWORD, password: 'nova-senha-456', passwordConfirmation: 'nova-senha-456' })
      .expect(204);

    expect(await auth.authenticate(other)).toBeNull();
    expect(await auth.authenticate(token)).not.toBeNull();
  });

  it('drops every session when a password reset is confirmed', async () => {
    const { app, auth, mail, mailer, token } = await withPatient();
    await request(app).post('/api/password-reset/request').send({ email: 'ana.silva@email.com' }).expect(204);
    await mail.drain();
    const reset = /#token=([A-Za-z0-9_-]{43})/.exec(mailer.sent.at(-1)?.text ?? '')?.[1];

    await request(app)
      .post('/api/password-reset/confirm')
      .send({ token: reset, password: 'nova-senha-456', passwordConfirmation: 'nova-senha-456' })
      .expect(204);

    expect(await auth.authenticate(token)).toBeNull();
  });

  it('drops the session of a deactivated account', async () => {
    const { app, admin, auth, token, userId } = await withAdmin();

    await request(app).post(`/api/admin/users/${userId}/deactivate`).set(as(admin)).expect(200);

    expect(await auth.authenticate(token)).toBeNull();
  });

  it('reflects granted and revoked roles on the next request', async () => {
    const { app, admin, auth, token, userId } = await withAdmin();

    await request(app).post(`/api/admin/users/${userId}/roles/admin`).set(as(admin)).expect(200);
    expect((await auth.authenticate(token))?.user.roles).toEqual(['admin', 'patient']);
    await request(app).delete(`/api/admin/users/${userId}/roles/admin`).set(as(admin)).expect(200);

    expect((await auth.authenticate(token))?.user.roles).toEqual(['patient']);
  });

  it('reflects a profile change on the next request', async () => {
    const { app, auth, token } = await withPatient();

    await request(app).patch('/api/me').set(as(token)).send({ fullName: 'Ana Souza' }).expect(200);

    expect((await auth.authenticate(token))?.user.fullName).toBe('Ana Souza');
  });

  it('drops a session evicted by the per-user limit on login', async () => {
    const { app, auth, token } = await withPatient();
    for (let index = 0; index < 10; index += 1) await tokenOf(app);

    expect(await auth.authenticate(token)).toBeNull();
  });
});
