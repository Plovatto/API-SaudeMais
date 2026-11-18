import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { EXAMPLE_PATIENT } from '@/modules/seed/seed.data.js';
import { createSessionToken } from '@/modules/users/user.token.js';
import { buildUsersApp, HOUR, login, registerAndLogin, START } from './support/users.js';

type App = Parameters<typeof request>[0];
type Session = { id: string; current: boolean };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const changePassword = (app: App, token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/me/password')
    .set(auth(token))
    .send({
      currentPassword: 'senha-segura-123',
      password: 'nova-senha-456',
      passwordConfirmation: 'nova-senha-456',
      ...body,
    });

describe('GET and PATCH /api/me', () => {
  it('returns the account of the token without letting the browser cache it', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    const response = await request(app).get('/api/me').set(auth(token));

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ email: 'ana.silva@email.com', phone: '+5511987654321', roles: ['patient'] });
  });

  it('changes only the fields sent and can remove the phone', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    const renamed = await request(app).patch('/api/me').set(auth(token)).send({ fullName: 'Ana Souza' });
    const withoutPhone = await request(app).patch('/api/me').set(auth(token)).send({ phone: null });

    expect(renamed.body).toMatchObject({ fullName: 'Ana Souza', phone: '+5511987654321' });
    expect(withoutPhone.body).toMatchObject({ fullName: 'Ana Souza', phone: null });
  });

  it('starts without a birth date or a password change', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    const response = await request(app).get('/api/me').set(auth(token));

    expect(response.body).toMatchObject({ birthDate: null, passwordChangedAt: null });
  });

  it('saves the birth date up to today in São Paulo and removes it with null', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    const saved = await request(app).patch('/api/me').set(auth(token)).send({ birthDate: '2026-11-20' });
    const removed = await request(app).patch('/api/me').set(auth(token)).send({ birthDate: null });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ birthDate: '2026-11-20', phone: '+5511987654321' });
    expect(removed.body).toMatchObject({ birthDate: null });
  });

  it('rejects a birth date after today in São Paulo', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    const response = await request(app).patch('/api/me').set(auth(token)).send({ birthDate: '2026-11-21' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { birthDate: 'A data de nascimento não pode ser no futuro.' },
    });
  });

  it('uses the São Paulo day, not the UTC day, to tell the future', async () => {
    const { app, clock } = await buildUsersApp();
    clock.advance(13 * HOUR);
    const token = await registerAndLogin(app);

    const utcToday = await request(app).patch('/api/me').set(auth(token)).send({ birthDate: '2026-11-21' });
    const saoPauloToday = await request(app).patch('/api/me').set(auth(token)).send({ birthDate: '2026-11-20' });

    expect(utcToday.status).toBe(400);
    expect(saoPauloToday.status).toBe(200);
  });

  it.each([
    ['an empty body', {}],
    ['the e-mail', { email: 'outro@email.com' }],
    ['an invalid phone', { phone: '123' }],
    ['a birth date before 1900', { birthDate: '1899-12-31' }],
    ['an impossible birth date', { birthDate: '1990-02-30' }],
    ['a birth date with time', { birthDate: '1990-02-10T00:00:00Z' }],
  ])('rejects %s', async (_case, body) => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    expect((await request(app).patch('/api/me').set(auth(token)).send(body)).status).toBe(400);
  });

  it('requires a session', async () => {
    const { app } = await buildUsersApp();

    expect((await request(app).get('/api/me')).status).toBe(401);
  });
});

describe('POST /api/me/password', () => {
  it('requires the current password', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    const response = await changePassword(app, token, { currentPassword: 'senha-errada-000' });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
  });

  it('changes the password and ends the other sessions, keeping the current one', async () => {
    const { app, auth: service } = await buildUsersApp();
    const current = await registerAndLogin(app);
    const other = ((await login(app)).body as { token: string }).token;

    expect((await changePassword(app, current, {})).status).toBe(204);

    expect(await service.authenticate(current)).not.toBeNull();
    expect(await service.authenticate(other)).toBeNull();
    expect((await request(app).get('/api/me').set(auth(current))).body).toMatchObject({
      passwordChangedAt: START.toISOString(),
    });
    expect((await login(app)).status).toBe(401);
    expect((await login(app, { password: 'nova-senha-456' })).status).toBe(200);
  });

  it('blocks the account after 5 wrong current passwords, even from different addresses', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await changePassword(app, token, { currentPassword: 'senha-errada-000' }).expect(422);
    }

    const blocked = await changePassword(app, token, {});

    expect(blocked.status).toBe(429);
  });

  it('refuses a session that a login with the old password created during the change', async () => {
    const { app, db, clock, auth: service } = await buildUsersApp();
    const token = await registerAndLogin(app);
    const stale = createSessionToken();
    const [user] = (await db.execute<{ id: string }>(sql`select id from users`)).rows;
    clock.advance(60_000);

    await changePassword(app, token, {}).expect(204);
    await db.execute(sql`
      insert into sessions (user_id, token_hash, remember, created_at, last_used_at, expires_at, absolute_expires_at)
      values (${user?.id}, ${stale.tokenHash}, false, ${START}, ${START}, ${new Date(START.getTime() + 3_600_000)}, ${new Date(START.getTime() + 3_600_000)})
    `);

    expect(await service.authenticate(stale.token)).toBeNull();
    expect(await service.authenticate(token)).not.toBeNull();
  });

  it('rejects a confirmation that does not match', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    expect((await changePassword(app, token, { passwordConfirmation: 'outra-senha-789' })).status).toBe(400);
  });
});

describe('sessions', () => {
  it('lists the active sessions and marks the current one', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);
    await login(app);

    const response = await request(app).get('/api/me/sessions').set(auth(token));

    expect(response.status).toBe(200);
    const sessions = response.body as { current: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
  });

  it('signs out everywhere', async () => {
    const { app, auth: service } = await buildUsersApp();
    const current = await registerAndLogin(app);
    const other = ((await login(app)).body as { token: string }).token;

    expect((await request(app).delete('/api/me/sessions').set(auth(current))).status).toBe(204);

    expect(await service.authenticate(current)).toBeNull();
    expect(await service.authenticate(other)).toBeNull();
  });

  it('ends the other sessions and keeps the current one', async () => {
    const { app, auth: service } = await buildUsersApp();
    const current = await registerAndLogin(app);
    const other = ((await login(app)).body as { token: string }).token;

    expect((await request(app).delete('/api/me/sessions/others').set(auth(current))).status).toBe(204);

    expect(await service.authenticate(current)).not.toBeNull();
    expect(await service.authenticate(other)).toBeNull();
  });

  it('ends one session of the account', async () => {
    const { app, auth: service } = await buildUsersApp();
    const current = await registerAndLogin(app);
    const other = ((await login(app)).body as { token: string }).token;
    const sessions = (await request(app).get('/api/me/sessions').set(auth(current))).body as Session[];
    const target = sessions.find((session) => !session.current);

    expect((await request(app).delete(`/api/me/sessions/${target?.id}`).set(auth(current))).status).toBe(204);

    expect(await service.authenticate(other)).toBeNull();
    expect(await service.authenticate(current)).not.toBeNull();
  });

  it('refuses to end the current session through the single-session route', async () => {
    const { app, auth: service } = await buildUsersApp();
    const current = await registerAndLogin(app);
    const sessions = (await request(app).get('/api/me/sessions').set(auth(current))).body as Session[];

    const response = await request(app).delete(`/api/me/sessions/${sessions[0]?.id}`).set(auth(current));

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'CURRENT_SESSION' });
    expect(await service.authenticate(current)).not.toBeNull();
  });

  it('answers 404 for a session of another account and keeps it', async () => {
    const { app, auth: service } = await buildUsersApp();
    const mine = await registerAndLogin(app);
    const theirs = await registerAndLogin(app, {}, { email: 'bruno@email.com' });
    const [their] = (await request(app).get('/api/me/sessions').set(auth(theirs))).body as Session[];

    const response = await request(app).delete(`/api/me/sessions/${their?.id}`).set(auth(mine));

    expect(response.status).toBe(404);
    expect(await service.authenticate(theirs)).not.toBeNull();
  });

  it('rejects a malformed session id', async () => {
    const { app } = await buildUsersApp();
    const token = await registerAndLogin(app);

    expect((await request(app).delete('/api/me/sessions/abc').set(auth(token))).status).toBe(400);
  });
});

describe('example patient', () => {
  async function exampleApp() {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount(EXAMPLE_PATIENT);
    const { email, password } = EXAMPLE_PATIENT;
    const first = ((await login(context.app, { email, password })).body as { token: string }).token;
    const second = ((await login(context.app, { email, password })).body as { token: string }).token;
    return { ...context, first, second };
  }

  it('can change its data and password', async () => {
    const { app, first } = await exampleApp();

    const patch = await request(app)
      .patch('/api/me')
      .set(auth(first))
      .send({ fullName: 'Outro Nome', birthDate: '1990-01-01' });
    const password = await changePassword(app, first, { currentPassword: EXAMPLE_PATIENT.password });

    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ fullName: 'Outro Nome', birthDate: '1990-01-01' });
    expect(password.status).toBe(204);
  });

  it('signs out every session like any other account', async () => {
    const { app, auth: service, first, second } = await exampleApp();

    await request(app).delete('/api/me/sessions').set(auth(first)).expect(204);

    expect(await service.authenticate(first)).toBeNull();
    expect(await service.authenticate(second)).toBeNull();
  });

  it('ends the other sessions like any other account', async () => {
    const { app, auth: service, first, second } = await exampleApp();

    await request(app).delete('/api/me/sessions/others').set(auth(first)).expect(204);

    expect(await service.authenticate(first)).not.toBeNull();
    expect(await service.authenticate(second)).toBeNull();
  });
});
