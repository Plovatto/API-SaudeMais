import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { startOfDayIn } from '@/lib/time.js';
import { PasswordResetRepository } from '@/modules/password-reset/password-reset.repository.js';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { buildUsersApp, login, registerAndLogin, registration, START } from './support/users.js';

type Context = Awaited<ReturnType<typeof buildUsersApp>>;
const MINUTE = 60_000;

const requestReset = (app: Context['app'], email = 'ana.silva@email.com') =>
  request(app).post('/api/password-reset/request').send({ email });

const confirmReset = (app: Context['app'], token: string, password = 'nova-senha-456') =>
  request(app).post('/api/password-reset/confirm').send({ token, password, passwordConfirmation: password });

async function sentToken({ mail, mailer }: Context): Promise<string> {
  await mail.drain();
  const link = /#token=([A-Za-z0-9_-]{43})/.exec(mailer.sent.at(-1)?.text ?? '');
  if (!link?.[1]) throw new Error('No reset link was sent');
  return link[1];
}

async function withAccount() {
  const context = await buildUsersApp();
  const token = await registerAndLogin(context.app);
  return { ...context, sessionToken: token };
}

describe('POST /api/password-reset/request', () => {
  it('sends a link with a single-use token to the account e-mail', async () => {
    const context = await withAccount();

    expect((await requestReset(context.app, ' ANA.SILVA@email.com ')).status).toBe(204);
    await context.mail.drain();

    expect(context.mailer.sent).toHaveLength(1);
    expect(context.mailer.sent[0]).toMatchObject({
      to: 'ana.silva@email.com',
      subject: 'Redefinição de senha do Saúde+',
    });
    expect(context.mailer.sent[0]?.text).toContain('https://app.saudemais.test/redefinir-senha#token=');
  });

  it('answers the same for an unknown e-mail, without sending anything', async () => {
    const context = await withAccount();

    const response = await requestReset(context.app, 'ninguem@email.com');
    await context.mail.drain();

    expect(response.status).toBe(204);
    expect(context.mailer.sent).toHaveLength(0);
  });

  it('never sends a link to the protected demo account', async () => {
    const context = await buildUsersApp();
    await context.modules.users.bootstrap(undefined);

    await requestReset(context.app, DEMO_ACCOUNTS[0]?.email).expect(204);
    await context.mail.drain();

    expect(context.mailer.sent).toHaveLength(0);
  });

  it('waits 15 minutes between links and sends at most 3 per day', async () => {
    const context = await withAccount();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await requestReset(context.app).expect(204);
      context.clock.advance(5 * MINUTE);
    }
    await context.mail.drain();
    expect(context.mailer.sent).toHaveLength(2);

    context.clock.advance(20 * MINUTE);
    await requestReset(context.app).expect(204);
    context.clock.advance(20 * MINUTE);
    await requestReset(context.app).expect(204);
    await context.mail.drain();

    expect(context.mailer.sent).toHaveLength(3);
  });

  it('keeps the 15 minutes between links across midnight', async () => {
    const context = await withAccount();
    context.clock.advance(Date.parse('2026-11-21T02:55:00Z') - START.getTime());

    await requestReset(context.app).expect(204);
    context.clock.advance(10 * MINUTE);
    await requestReset(context.app).expect(204);
    await context.mail.drain();

    expect(context.mailer.sent).toHaveLength(1);
  });

  it('stops sending once the daily total for the whole site is reached', async () => {
    const context = await buildUsersApp();
    const ids: string[] = [];
    for (const email of ['a@email.com', 'b@email.com', 'c@email.com']) {
      const created = await request(context.app).post('/api/users/register').send(registration({ email }));
      ids.push((created.body as { id: string }).id);
    }
    const resets = new PasswordResetRepository(context.db, {
      perUserPerDay: 3,
      globalPerDay: 2,
      minIntervalMs: 15 * MINUTE,
    });
    const now = context.clock.now();

    const results = [];
    for (const [index, userId] of ids.entries()) {
      results.push(
        await resets.issue({
          userId,
          requestedBy: null,
          tokenHash: String(index).repeat(64),
          now,
          expiresAt: new Date(now.getTime() + 30 * MINUTE),
          dayStart: startOfDayIn('America/Sao_Paulo', now),
        }),
      );
    }

    expect(results).toEqual([true, true, false]);
  });

  it('invalidates the previous link when a new one is sent', async () => {
    const context = await withAccount();
    await requestReset(context.app);
    const first = await sentToken(context);
    context.clock.advance(16 * MINUTE);
    await requestReset(context.app);
    const second = await sentToken(context);

    expect((await confirmReset(context.app, first)).status).toBe(400);
    expect((await confirmReset(context.app, second)).status).toBe(204);
  });
});

describe('POST /api/password-reset/confirm', () => {
  it('sets the new password and ends every session', async () => {
    const context = await withAccount();
    await requestReset(context.app);
    const token = await sentToken(context);

    expect((await confirmReset(context.app, token)).status).toBe(204);

    expect(await context.auth.authenticate(context.sessionToken)).toBeNull();
    expect((await login(context.app)).status).toBe(401);
    expect((await login(context.app, { password: 'nova-senha-456' })).status).toBe(200);
  });

  it('accepts a token only once', async () => {
    const context = await withAccount();
    await requestReset(context.app);
    const token = await sentToken(context);
    await confirmReset(context.app, token).expect(204);

    const again = await confirmReset(context.app, token, 'outra-senha-789');

    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('refuses a token after 30 minutes', async () => {
    const context = await withAccount();
    await requestReset(context.app);
    const token = await sentToken(context);

    context.clock.advance(30 * MINUTE);

    expect((await confirmReset(context.app, token)).status).toBe(400);
  });

  it('refuses a deactivated account', async () => {
    const context = await withAccount();
    await requestReset(context.app);
    const token = await sentToken(context);
    await context.db.execute(sql`update users set deactivated_at = now()`);

    expect((await confirmReset(context.app, token)).status).toBe(400);
  });

  it.each([
    ['a malformed token', { token: 'curto', password: 'nova-senha-456', passwordConfirmation: 'nova-senha-456' }],
    ['a short password', { token: 'A'.repeat(43), password: 'curta', passwordConfirmation: 'curta' }],
    [
      'a different confirmation',
      { token: 'A'.repeat(43), password: 'nova-senha-456', passwordConfirmation: 'outra-456' },
    ],
  ])('rejects %s', async (_case, body) => {
    const { app } = await buildUsersApp();

    const response = await request(app).post('/api/password-reset/confirm').send(body);

    expect(response.status).toBe(400);
  });
});

describe('startOfDayIn', () => {
  it('returns midnight in São Paulo as an instant', () => {
    expect(startOfDayIn('America/Sao_Paulo', new Date('2026-11-20T02:30:00Z')).toISOString()).toBe(
      '2026-11-19T03:00:00.000Z',
    );
    expect(startOfDayIn('America/Sao_Paulo', new Date('2026-11-20T12:00:00Z')).toISOString()).toBe(
      '2026-11-20T03:00:00.000Z',
    );
  });

  it('follows offset changes instead of assuming a fixed one', () => {
    expect(startOfDayIn('America/New_York', new Date(Date.UTC(2026, 6, 1, 12))).toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(startOfDayIn('America/New_York', new Date(Date.UTC(2026, 0, 15, 12))).toISOString()).toBe(
      '2026-01-15T05:00:00.000Z',
    );
  });
});
