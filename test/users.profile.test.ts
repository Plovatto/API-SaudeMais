import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { buildUsersApp, login, registerAndLogin } from './support/users.js';

type App = Parameters<typeof request>[0];
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const demo = (() => {
  const account = DEMO_ACCOUNTS[0];
  if (!account) throw new Error('A demo account is expected');
  return account;
})();

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

  it.each([
    ['an empty body', {}],
    ['the e-mail', { email: 'outro@email.com' }],
    ['an invalid phone', { phone: '123' }],
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
});

describe('protected demo account', () => {
  async function demoApp() {
    const context = await buildUsersApp();
    await context.modules.users.bootstrap(undefined);
    const first = ((await login(context.app, { email: demo.email, password: demo.password })).body as { token: string })
      .token;
    const second = (
      (await login(context.app, { email: demo.email, password: demo.password })).body as { token: string }
    ).token;
    return { ...context, first, second };
  }

  it('cannot change its data or password', async () => {
    const { app, first } = await demoApp();

    const patch = await request(app).patch('/api/me').set(auth(first)).send({ fullName: 'Outro Nome' });
    const password = await changePassword(app, first, { currentPassword: demo.password });

    expect(patch.status).toBe(403);
    expect(password.status).toBe(403);
    expect(password.body).toMatchObject({ code: 'PROTECTED_ACCOUNT' });
  });

  it('signs out only the visitor who asked', async () => {
    const { app, auth: service, first, second } = await demoApp();

    await request(app).delete('/api/me/sessions').set(auth(first)).expect(204);

    expect(await service.authenticate(first)).toBeNull();
    expect(await service.authenticate(second)).not.toBeNull();
  });
});
