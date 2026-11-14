import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationParams, NotificationType } from '@/database/schema/notifications.js';
import type { Role } from '@/database/schema/users.js';
import { MINUTE } from '@/lib/time.js';
import { UnreadCounter } from '@/modules/notifications/notifications.counter.js';
import { NotificationsRepository } from '@/modules/notifications/notifications.repository.js';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { as, buildUsersApp, login, registration } from './support/users.js';
import { fixedClock } from './support/fixed-clock.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const PATH = '/api/notifications';

type Context = Awaited<ReturnType<typeof withAdmin>>;

interface Item {
  id: string;
  type: NotificationType;
  params: NotificationParams;
  bookingId: string | null;
  readAt: string | null;
  createdAt: string;
}

async function session(
  context: { app: Awaited<ReturnType<typeof buildUsersApp>>['app'] },
  credentials: Record<string, unknown> = {},
) {
  const body = (await login(context.app, credentials).expect(200)).body as { token: string; user: { id: string } };
  return { token: body.token, id: body.user.id };
}

async function withAdmin() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN, { demoAccounts: false });
  return { ...context, admin: await session(context, ADMIN) };
}

async function register(context: Context, fullName: string, email: string) {
  context.clock.advance(MINUTE);
  const created = await request(context.app)
    .post('/api/users/register')
    .send(registration({ fullName, email }))
    .expect(201);
  return (created.body as { id: string }).id;
}

async function deliver(
  context: Context,
  userId: string,
  audienceRole: Role,
  type: NotificationType = 'appointment_confirmed',
) {
  context.clock.advance(MINUTE);
  const bookingId = type === 'user_registered' ? null : randomUUID();
  const afterCommit = await context.db.transaction((tx) =>
    context.modules.notifications.service.notify(tx, [{ userId, audienceRole, type, bookingId, params: {} }]),
  );
  afterCommit();
}

const list = (context: Context, token: string, query: string) =>
  request(context.app).get(`${PATH}?${query}`).set(as(token));

const unread = async (context: Context, token: string, role: Role) =>
  (
    (await request(context.app).get(`${PATH}/unread-count?role=${role}`).set(as(token)).expect(200)).body as {
      count: number;
    }
  ).count;

const itemsOf = (response: { body: unknown }) => (response.body as { items: Item[] }).items;

function constraintOf(error: unknown): string | undefined {
  let current = error as { constraint?: string; cause?: unknown } | undefined;
  while (current && !current.constraint) current = current.cause as typeof current;
  return current?.constraint;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('access', () => {
  it('requires a session on every route', async () => {
    const context = await withAdmin();
    const id = randomUUID();

    expect((await request(context.app).get(`${PATH}?role=admin`)).status).toBe(401);
    expect((await request(context.app).get(`${PATH}/unread-count?role=admin`)).status).toBe(401);
    expect((await request(context.app).post(`${PATH}/${id}/read`)).status).toBe(401);
    expect((await request(context.app).post(`${PATH}/read-all?role=admin`)).status).toBe(401);
  });

  it('requires the role of the open area and refuses roles the account does not have', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    const patient = await session(context);

    for (const route of [`${PATH}`, `${PATH}/unread-count`]) {
      const missing = await request(context.app).get(route).set(as(patient.token));
      expect(missing.status).toBe(400);
      expect(missing.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        fields: { role: 'Informe o perfil da área aberta.' },
      });
      expect((await request(context.app).get(`${route}?role=nurse`).set(as(patient.token))).status).toBe(400);
      const foreign = await request(context.app).get(`${route}?role=admin`).set(as(patient.token));
      expect(foreign.status).toBe(403);
      expect(foreign.body).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await request(context.app).post(`${PATH}/read-all`).set(as(patient.token))).status).toBe(400);
    expect((await request(context.app).post(`${PATH}/read-all?role=doctor`).set(as(patient.token))).status).toBe(403);
    expect((await request(context.app).post(`${PATH}/not-a-uuid/read`).set(as(patient.token))).status).toBe(400);
  });

  it('lets the demo account read notifications but never mark them read', async () => {
    const context = await withAdmin();
    await context.modules.users.bootstrap(undefined);
    const [demo] = DEMO_ACCOUNTS;
    const visitor = await session(context, { email: demo?.email, password: demo?.password });
    await deliver(context, visitor.id, 'patient');
    const [item] = itemsOf(await list(context, visitor.token, 'role=patient').expect(200));

    const one = await request(context.app).post(`${PATH}/${item?.id}/read`).set(as(visitor.token));
    const all = await request(context.app).post(`${PATH}/read-all?role=patient`).set(as(visitor.token));

    expect(one.status).toBe(403);
    expect(one.body).toMatchObject({ code: 'PROTECTED_ACCOUNT' });
    expect(all.status).toBe(403);
    expect(all.body).toMatchObject({ code: 'PROTECTED_ACCOUNT' });
    expect(await unread(context, visitor.token, 'patient')).toBe(1);
  });
});

describe('user_registered', () => {
  it('notifies every active admin, and only admins, when a patient registers', async () => {
    const context = await withAdmin();
    const carla = await register(context, 'Carla Dias', 'carla@email.com');
    const davi = await register(context, 'Davi Lima', 'davi@email.com');
    await context.db.execute(
      sql`insert into user_roles (user_id, role, granted_at) values (${carla}, 'admin', now()), (${davi}, 'admin', now())`,
    );
    await context.db.execute(sql`update users set deactivated_at = now() where id = ${davi}`);

    const ana = await register(context, 'Ana Maria Silva', 'ana.silva@email.com');

    const rows = await context.db.execute<{
      user_id: string;
      audience_role: string;
      type: string;
      booking_id: null;
      params: object;
    }>(
      sql`select user_id, audience_role, type, booking_id, params from notifications where params->>'userId' = ${ana} order by user_id`,
    );
    expect(rows.rows).toEqual(
      [context.admin.id, carla].sort().map((userId) => ({
        user_id: userId,
        audience_role: 'admin',
        type: 'user_registered',
        booking_id: null,
        params: { userId: ana },
      })),
    );
    const others = await context.db.execute<{ total: number }>(
      sql`select count(*)::int as total from notifications where audience_role <> 'admin'`,
    );
    expect(others.rows[0]?.total).toBe(0);
  });

  it('does not notify anyone when the registration fails or a seed account is created', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    await request(context.app).post('/api/users/register').send(registration()).expect(409);
    await context.modules.users.bootstrap(undefined);

    const rows = await context.db.execute<{ total: number }>(sql`select count(*)::int as total from notifications`);
    expect(rows.rows[0]?.total).toBe(1);
  });

  it('rolls the registration back and keeps the cached count when the notification insert fails', async () => {
    const context = await withAdmin();
    expect(await unread(context, context.admin.token, 'admin')).toBe(0);
    const counted = vi.spyOn(NotificationsRepository.prototype, 'unreadCount');
    vi.spyOn(NotificationsRepository.prototype, 'insert').mockRejectedValueOnce(new Error('insert failed'));

    await request(context.app).post('/api/users/register').send(registration()).expect(500);

    const rows = await context.db.execute<{ users: number; notifications: number }>(
      sql`select (select count(*)::int from users where email = 'ana.silva@email.com') as users, (select count(*)::int from notifications) as notifications`,
    );
    expect(rows.rows[0]).toEqual({ users: 0, notifications: 0 });
    expect(await unread(context, context.admin.token, 'admin')).toBe(0);
    expect(counted).not.toHaveBeenCalled();
  });
});

describe('GET /api/notifications', () => {
  it('lists the notifications of the open area, newest first and paginated', async () => {
    const context = await withAdmin();
    const carla = await register(context, 'Carla Dias', 'carla@email.com');
    await deliver(context, context.admin.id, 'patient');
    const ana = await register(context, 'Ana Maria Silva', 'ana.silva@email.com');

    const response = await list(context, context.admin.token, 'role=admin').expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(itemsOf(response)).toEqual([
      {
        id: expect.any(String) as unknown,
        type: 'user_registered',
        params: { userId: ana, fullName: 'Ana Maria Silva' },
        bookingId: null,
        readAt: null,
        createdAt: new Date(context.clock.now()).toISOString(),
      },
      expect.objectContaining({ params: { userId: carla, fullName: 'Carla Dias' } }),
    ]);
    const second = await list(context, context.admin.token, 'role=admin&page=2&pageSize=1').expect(200);
    expect(second.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(itemsOf(second)).toEqual([expect.objectContaining({ params: { userId: carla, fullName: 'Carla Dias' } })]);
    const patientArea = itemsOf(await list(context, context.admin.token, 'role=patient').expect(200));
    expect(patientArea).toEqual([
      expect.objectContaining({ type: 'appointment_confirmed', bookingId: expect.any(String) as unknown }),
    ]);
  });

  it('shows the current name of the registered account', async () => {
    const context = await withAdmin();
    const ana = await register(context, 'Ana Maria Silva', 'ana.silva@email.com');

    await context.db.execute(sql`update users set full_name = 'Ana Souza' where id = ${ana}`);

    expect(itemsOf(await list(context, context.admin.token, 'role=admin'))).toEqual([
      expect.objectContaining({ params: { userId: ana, fullName: 'Ana Souza' } }),
    ]);
  });

  it('never shows the notifications of another account', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    await deliver(context, context.admin.id, 'patient');
    const patient = await session(context);

    expect((await list(context, patient.token, 'role=patient').expect(200)).body).toMatchObject({
      items: [],
      total: 0,
    });
  });
});

describe('POST /api/notifications/:id/read', () => {
  it('marks a notification read once, keeping the first read time', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    const [item] = itemsOf(await list(context, context.admin.token, 'role=admin'));
    const readAt = new Date(context.clock.now()).toISOString();

    const first = await request(context.app).post(`${PATH}/${item?.id}/read`).set(as(context.admin.token));
    context.clock.advance(MINUTE);
    await request(context.app).post(`${PATH}/${item?.id}/read`).set(as(context.admin.token)).expect(204);

    expect(first.status).toBe(204);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(itemsOf(await list(context, context.admin.token, 'role=admin'))).toEqual([
      expect.objectContaining({ readAt }),
    ]);
  });

  it('answers 404 for a notification of another account or one that does not exist', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    const [item] = itemsOf(await list(context, context.admin.token, 'role=admin'));
    const patient = await session(context);

    const foreign = await request(context.app).post(`${PATH}/${item?.id}/read`).set(as(patient.token));
    const missing = await request(context.app).post(`${PATH}/${randomUUID()}/read`).set(as(patient.token));

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: 'NOT_FOUND', message: 'Notificação não encontrada.' });
    expect(missing.status).toBe(404);
    expect(itemsOf(await list(context, context.admin.token, 'role=admin'))).toEqual([
      expect.objectContaining({ readAt: null }),
    ]);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('marks every notification of the open area read and leaves the other areas alone', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    await register(context, 'Carla Dias', 'carla@email.com');
    await deliver(context, context.admin.id, 'patient');

    const response = await request(context.app).post(`${PATH}/read-all?role=admin`).set(as(context.admin.token));

    expect(response.status).toBe(204);
    expect(await unread(context, context.admin.token, 'admin')).toBe(0);
    expect(await unread(context, context.admin.token, 'patient')).toBe(1);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('serves the count from memory without querying the database again', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    const counted = vi.spyOn(NotificationsRepository.prototype, 'unreadCount');

    const first = await request(context.app).get(`${PATH}/unread-count?role=admin`).set(as(context.admin.token));
    const second = await unread(context, context.admin.token, 'admin');

    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body).toEqual({ count: 1 });
    expect(second).toBe(1);
    expect(counted).toHaveBeenCalledTimes(1);
  });

  it('refreshes the count after new notifications, reads and when the cache expires', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    const counted = vi.spyOn(NotificationsRepository.prototype, 'unreadCount');
    expect(await unread(context, context.admin.token, 'admin')).toBe(1);

    await register(context, 'Carla Dias', 'carla@email.com');
    expect(await unread(context, context.admin.token, 'admin')).toBe(2);

    const [item] = itemsOf(await list(context, context.admin.token, 'role=admin'));
    await request(context.app).post(`${PATH}/${item?.id}/read`).set(as(context.admin.token)).expect(204);
    expect(await unread(context, context.admin.token, 'admin')).toBe(1);
    expect(counted).toHaveBeenCalledTimes(3);

    await context.db.execute(
      sql`insert into notifications (user_id, audience_role, type, params) values (${context.admin.id}, 'admin', 'user_registered', '{}')`,
    );
    expect(await unread(context, context.admin.token, 'admin')).toBe(1);
    context.clock.advance(10 * MINUTE);
    expect(await unread(context, context.admin.token, 'admin')).toBe(2);
    expect(counted).toHaveBeenCalledTimes(4);
  });

  it('keeps one count per role', async () => {
    const context = await withAdmin();
    await register(context, 'Ana Maria Silva', 'ana.silva@email.com');
    await deliver(context, context.admin.id, 'patient');
    await deliver(context, context.admin.id, 'patient');

    expect(await unread(context, context.admin.token, 'admin')).toBe(1);
    expect(await unread(context, context.admin.token, 'patient')).toBe(2);
  });
});

describe('UnreadCounter', () => {
  it('does not keep a count loaded before an invalidation', async () => {
    const counter = new UnreadCounter(fixedClock(new Date('2026-11-20T12:00:00.000Z')));
    let finish: (count: number) => void = () => undefined;
    const stale = counter.count('user:admin', () => new Promise<number>((resolve) => (finish = resolve)));

    counter.invalidate('user:admin');
    finish(1);

    expect(await stale).toBe(1);
    expect(await counter.count('user:admin', () => Promise.resolve(2))).toBe(2);
    expect(await counter.count('user:admin', () => Promise.resolve(3))).toBe(2);
  });

  it('caches the next load after a failed one', async () => {
    const counter = new UnreadCounter(fixedClock(new Date('2026-11-20T12:00:00.000Z')));

    await expect(counter.count('user:admin', () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');

    expect(await counter.count('user:admin', () => Promise.resolve(4))).toBe(4);
    expect(await counter.count('user:admin', () => Promise.resolve(5))).toBe(4);
  });

  it('evicts expired counts once it holds many keys', async () => {
    const clock = fixedClock(new Date('2026-11-20T12:00:00.000Z'));
    const counter = new UnreadCounter(clock);
    for (let index = 0; index < 1000; index += 1) await counter.count(`old-${index}`, () => Promise.resolve(1));
    clock.advance(10 * MINUTE);

    await counter.count('fresh', () => Promise.resolve(1));

    expect(counter.size).toBe(1);
  });
});

describe('notifications table', () => {
  async function rejected(
    context: Context,
    values: { type: NotificationType; bookingId: string | null; params: unknown; role?: string },
  ) {
    try {
      await context.db.transaction((tx) =>
        context.modules.notifications.service.notify(tx, [
          {
            userId: context.admin.id,
            audienceRole: (values.role ?? 'admin') as Role,
            type: values.type,
            bookingId: values.bookingId,
            params: values.params as NotificationParams,
          },
        ]),
      );
    } catch (error) {
      return constraintOf(error);
    }
    return undefined;
  }

  it('limits params to an object of up to 1 kB', async () => {
    const context = await withAdmin();
    const base = { type: 'user_registered' as const, bookingId: null };

    expect(await rejected(context, { ...base, params: { fullName: 'a'.repeat(1000) } })).toBeUndefined();
    expect(await rejected(context, { ...base, params: { fullName: 'a'.repeat(1024) } })).toBe(
      'notifications_params_check',
    );
    expect(await rejected(context, { ...base, params: ['a'] })).toBe('notifications_params_check');
  });

  it('requires a booking for every type except user_registered and a known role', async () => {
    const context = await withAdmin();

    expect(await rejected(context, { type: 'user_registered', bookingId: randomUUID(), params: {} })).toBe(
      'notifications_booking_check',
    );
    expect(await rejected(context, { type: 'appointment_confirmed', bookingId: null, params: {} })).toBe(
      'notifications_booking_check',
    );
    expect(await rejected(context, { type: 'user_registered', bookingId: null, params: {}, role: 'nurse' })).toBe(
      'notifications_audience_role_check',
    );
  });

  it('removes the notifications of a deleted account', async () => {
    const context = await withAdmin();
    await deliver(context, context.admin.id, 'patient');

    await context.db.execute(sql`delete from users where id = ${context.admin.id}`);

    const rows = await context.db.execute<{ total: number }>(sql`select count(*)::int as total from notifications`);
    expect(rows.rows[0]?.total).toBe(0);
  });
});
