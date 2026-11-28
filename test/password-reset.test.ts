import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/config/logger.js';
import { CLINIC_TIME_ZONE, startOfDayIn } from '@/lib/time.js';
import { PasswordResetRepository } from '@/modules/password-reset/password-reset.repository.js';
import { buildUsersApp, login, nextResetToken, registerAndLogin, registration, START } from './support/users.js';

type Context = Awaited<ReturnType<typeof buildUsersApp>>;
const MINUTE = 60_000;

const requestReset = (app: Context['app'], email = 'ana.silva@email.com') =>
  request(app).post('/api/password-reset/request').send({ email });

const confirmReset = (app: Context['app'], token: string, password = 'nova-senha-456') =>
  request(app).post('/api/password-reset/confirm').send({ token, password, passwordConfirmation: password });

const sentToken = (context: Context) => nextResetToken(context, () => requestReset(context.app).expect(204));

async function askDirectly(context: Context, email = 'ana.silva@email.com') {
  await context.modules.passwordReset.service.request({ email });
  await context.mail.drain();
  return context.mailer.sent.length;
}

async function withAccount() {
  const context = await buildUsersApp();
  const token = await registerAndLogin(context.app);
  return { ...context, sessionToken: token };
}

describe('POST /api/password-reset/request', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a link with a single-use token to the account e-mail', async () => {
    const context = await withAccount();

    await nextResetToken(context, () => requestReset(context.app, ' ANA.SILVA@email.com ').expect(204));

    expect(context.mailer.sent).toHaveLength(1);
    expect(context.mailer.sent[0]).toMatchObject({
      to: 'ana.silva@email.com',
      subject: 'Redefinição de senha do Saúde+',
    });
    expect(context.mailer.sent[0]?.text).toContain('https://app.saudemais.test/redefinir-senha#token=');
  });

  it('answers an unknown e-mail the same way, without sending anything', async () => {
    const context = await withAccount();

    const response = await requestReset(context.app, 'ninguem@email.com');

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
    expect(await askDirectly(context, 'ninguem@email.com')).toBe(0);
  });

  it('answers a deactivated account the same way, without sending anything', async () => {
    const context = await withAccount();
    await context.db.execute(sql`update users set deactivated_at = now()`);

    await requestReset(context.app).expect(204);

    expect(await askDirectly(context)).toBe(0);
  });

  it('answers before looking up the account and logs a failure instead of revealing it', async () => {
    const context = await withAccount();
    vi.spyOn(context.modules.passwordReset.service, 'request').mockRejectedValue(new Error('database down'));
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await requestReset(context.app).expect(204);

    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith(
        { err: expect.objectContaining({ message: 'database down' }) as unknown },
        'Password reset request failed',
      ),
    );
  });

  it('waits 30 seconds between links and sends at most 5 per hour', async () => {
    const context = await withAccount();
    const sent: number[] = [];
    const ask = async (advanceSeconds: number) => {
      context.clock.advance(advanceSeconds * 1000);
      sent.push(await askDirectly(context));
    };

    await ask(0);
    await ask(10);
    for (let attempt = 0; attempt < 4; attempt += 1) await ask(31);
    await ask(31);
    context.clock.advance(61 * MINUTE);
    await ask(0);

    expect(sent).toEqual([1, 1, 2, 3, 4, 5, 5, 6]);
  });

  it('keeps the 30 seconds between links across midnight', async () => {
    const context = await withAccount();
    context.clock.advance(Date.parse('2026-11-21T02:59:50Z') - START.getTime());

    expect(await askDirectly(context)).toBe(1);
    context.clock.advance(20_000);

    expect(await askDirectly(context)).toBe(1);
  });

  it('keeps sending links to every account however many were sent that day', async () => {
    const context = await buildUsersApp();
    const ids: string[] = [];
    for (const email of ['a@email.com', 'b@email.com', 'c@email.com']) {
      const created = await request(context.app).post('/api/users/register').send(registration({ email }));
      ids.push((created.body as { id: string }).id);
    }
    const resets = new PasswordResetRepository(context.db, { perUserPerHour: 5, minIntervalMs: 30_000 });
    const dayStart = startOfDayIn(CLINIC_TIME_ZONE, context.clock.now()).getTime();

    const results = [];
    for (let index = 0; index < 102; index += 1) {
      const now = new Date(dayStart + MINUTE + index * 5 * MINUTE);
      results.push(
        await resets.issue({
          userId: ids[index % ids.length] ?? '',
          requestedBy: null,
          tokenHash: index.toString(16).padStart(64, '0'),
          now,
          expiresAt: new Date(now.getTime() + 30 * MINUTE),
        }),
      );
    }

    expect(results.every(Boolean)).toBe(true);
  });

  it('accepts 30 requests per address a day', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: START });
    try {
      const { app } = await buildUsersApp();
      const statuses: number[] = [];
      for (let round = 0; round < 4; round += 1) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          statuses.push((await requestReset(app, 'ninguem@email.com')).status);
        }
        vi.setSystemTime(Date.now() + 16 * MINUTE);
      }

      expect(statuses.filter((status) => status === 204)).toHaveLength(30);
      expect(statuses.slice(30)).toEqual([429, 429]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates the previous link when a new one is sent', async () => {
    const context = await withAccount();
    const first = await sentToken(context);
    context.clock.advance(16 * MINUTE);
    const second = await sentToken(context);

    expect((await confirmReset(context.app, first)).status).toBe(400);
    expect((await confirmReset(context.app, second)).status).toBe(204);
  });
});

describe('POST /api/password-reset/confirm', () => {
  it('sets the new password and ends every session', async () => {
    const context = await withAccount();
    const token = await sentToken(context);

    expect((await confirmReset(context.app, token)).status).toBe(204);

    expect(await context.auth.authenticate(context.sessionToken)).toBeNull();
    expect((await login(context.app)).status).toBe(401);
    expect((await login(context.app, { password: 'nova-senha-456' })).status).toBe(200);
  });

  it('accepts a token only once', async () => {
    const context = await withAccount();
    const token = await sentToken(context);
    await confirmReset(context.app, token).expect(204);

    const again = await confirmReset(context.app, token, 'outra-senha-789');

    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('refuses a token after 30 minutes', async () => {
    const context = await withAccount();
    const token = await sentToken(context);

    context.clock.advance(30 * MINUTE);

    expect((await confirmReset(context.app, token)).status).toBe(400);
  });

  it('refuses a deactivated account', async () => {
    const context = await withAccount();
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
