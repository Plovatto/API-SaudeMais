import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditActions, auditLogs, type AuditAction } from '@/database/schema/index.js';
import { anyText, as, buildUsersApp, login, registerAndLogin } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const MISSING = '00000000-0000-7000-8000-000000000000';

interface Item {
  id: string;
  createdAt: string;
  actorType: string;
  actor: { id: string; fullName: string; email: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
}

interface Listing {
  items: Item[];
  nextCursor: string | null;
}

type Query = Record<string, string | number>;

let context: Awaited<ReturnType<typeof buildUsersApp>>;
let admin: string;
let patient: string;
let adminId: string;

const list = (query: Query = {}, token = admin) =>
  request(context.app).get('/api/admin/audit-logs').query(query).set(as(token));

const body = async (query: Query = {}) => (await list(query).expect(200)).body as Listing;

const entries = async (query: Query) =>
  (await body(query)).items.map(({ action, entityId }) => `${action}:${entityId}`);

const record = async (action: AuditAction, entityId: string, extra: Partial<typeof auditLogs.$inferInsert> = {}) => {
  await context.db.insert(auditLogs).values({
    actorType: 'user',
    actorId: adminId,
    action,
    entityType: 'user',
    entityId,
    metadata: { fields: ['fullName'] },
    ip: '203.0.113.7',
    ...extra,
  });
};

beforeAll(async () => {
  context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN);
  const session = (await login(context.app, ADMIN).expect(200)).body as { token: string; user: { id: string } };
  admin = session.token;
  adminId = session.user.id;
  patient = await registerAndLogin(context.app);
  await context.db.delete(auditLogs);
  await record('user.updated', 'a1', { createdAt: new Date('2026-11-01T02:59:59.000Z') });
  await record('user.deactivated', 'a1', { createdAt: new Date('2026-11-01T03:00:00.000Z') });
  await record('policy.updated', 'policy', { entityType: 'settings', createdAt: new Date('2026-11-05T12:00:00.000Z') });
  await record('user.updated', 'a2', { createdAt: new Date('2026-11-10T12:00:00.000Z') });
  await record('user.reactivated', 'a2', {
    actorType: 'system',
    actorId: null,
    ip: null,
    metadata: {},
    createdAt: new Date('2026-11-12T12:00:00.000Z'),
  });
}, 60_000);

describe('audit log listing', () => {
  it('is for administrators only', async () => {
    await request(context.app).get('/api/admin/audit-logs').expect(401);
    expect((await list({}, patient)).status).toBe(403);
  });

  it('lists the newest entries first with the actor and the recorded details', async () => {
    const { items, nextCursor } = await body();

    expect(nextCursor).toBeNull();
    expect(await entries({})).toEqual([
      'user.reactivated:a2',
      'user.updated:a2',
      'policy.updated:policy',
      'user.deactivated:a1',
      'user.updated:a1',
    ]);
    expect(items[4]).toEqual({
      id: anyText,
      createdAt: '2026-11-01T02:59:59.000Z',
      actorType: 'user',
      actor: { id: adminId, fullName: anyText, email: ADMIN.email },
      action: 'user.updated',
      entityType: 'user',
      entityId: 'a1',
      metadata: { fields: ['fullName'] },
      ip: '203.0.113.7',
    });
    expect(items[0]).toMatchObject({ actorType: 'system', actor: null, ip: null, metadata: {} });
  });

  it('keeps an entry whose actor no longer has a user', async () => {
    await record('user.updated', 'orphan', { actorId: MISSING });

    const [first] = (await body()).items;

    expect(first).toMatchObject({ entityId: 'orphan', actor: null, actorType: 'user' });
    await context.db.delete(auditLogs).where(eq(auditLogs.entityId, 'orphan'));
  });

  it('pages with a keyset cursor without repeating or skipping entries', async () => {
    const first = await body({ limit: 2 });
    const second = await body({ limit: 2, cursor: first.nextCursor ?? '' });
    const third = await body({ limit: 2, cursor: second.nextCursor ?? '' });

    expect(first.nextCursor).toBe(first.items[1]?.id);
    expect([first, second, third].map(({ items }) => items.length)).toEqual([2, 2, 1]);
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map(({ id }) => id);
    expect(ids).toEqual((await body()).items.map(({ id }) => id));
  });

  it('keeps the cursor stable while new entries arrive', async () => {
    const first = await body({ limit: 2 });
    await record('user.updated', 'late');

    const second = await body({ limit: 10, cursor: first.nextCursor ?? '' });

    expect(second.items.map(({ entityId }) => entityId)).toEqual(['policy', 'a1', 'a1']);
    await context.db.delete(auditLogs).where(eq(auditLogs.entityId, 'late'));
  });

  it('filters by action, actor and entity', async () => {
    expect(await entries({ action: 'user.updated' })).toEqual(['user.updated:a2', 'user.updated:a1']);
    expect((await body({ actorId: adminId })).items).toHaveLength(4);
    expect(await entries({ entityType: 'settings' })).toEqual(['policy.updated:policy']);
    expect(await entries({ entityType: 'user', entityId: 'a1' })).toEqual(['user.deactivated:a1', 'user.updated:a1']);
    expect(await entries({ actorId: MISSING })).toEqual([]);
  });

  it('filters by civil days in the São Paulo time zone', async () => {
    expect(await entries({ from: '2026-11-01', to: '2026-11-01' })).toEqual(['user.deactivated:a1']);
    expect(await entries({ from: '2026-11-05' })).toEqual([
      'user.reactivated:a2',
      'user.updated:a2',
      'policy.updated:policy',
    ]);
    expect(await entries({ to: '2026-10-31' })).toEqual(['user.updated:a1']);
    expect(await entries({ from: '2026-11-02', to: '2026-11-09' })).toEqual(['policy.updated:policy']);
  });

  it('combines filters', async () => {
    expect(await entries({ action: 'user.updated', from: '2026-11-05', actorId: adminId })).toEqual([
      'user.updated:a2',
    ]);
  });

  it.each([
    ['limit', 0],
    ['limit', 101],
    ['limit', 1.5],
    ['cursor', 'abc'],
    ['actorId', 'abc'],
    ['action', 'user.exploded'],
    ['from', '01/11/2026'],
    ['to', '2026-13-01'],
    ['entityType', 'x'.repeat(41)],
    ['entityId', 'x'.repeat(65)],
  ])('refuses %s = %s with VALIDATION_ERROR', async (field, value) => {
    const response = await list({ [field]: value });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { [field]: anyText } });
  });

  it('refuses an end before the start and unknown parameters', async () => {
    expect((await list({ from: '2026-11-10', to: '2026-11-09' })).status).toBe(400);
    expect((await list({ page: 2 })).status).toBe(400);
  });

  it('returns 30 entries by default and up to 100 on request', async () => {
    await context.db.insert(auditLogs).values(
      Array.from({ length: 40 }, (_, index) => ({
        actorType: 'system' as const,
        action: 'policy.updated' as const,
        entityId: `bulk-${index}`,
      })),
    );

    const defaults = await body();
    expect(defaults.items).toHaveLength(30);
    expect(defaults.nextCursor).toBe(defaults.items[29]?.id);
    expect((await body({ limit: 100 })).items).toHaveLength(45);
    await context.db.delete(auditLogs).where(eq(auditLogs.actorType, 'system'));
  });

  it('shows what an administrator just did through the API', async () => {
    await request(context.app)
      .patch(`/api/admin/users/${adminId}`)
      .set(as(admin))
      .send({ fullName: 'Administrador Renomeado' })
      .expect(200);

    const { items } = await body({ action: 'user.updated', entityId: adminId });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ actor: { id: adminId }, metadata: { fields: ['fullName'] } });
  });

  it('keeps the action catalog free of duplicates', () => {
    expect(new Set(auditActions).size).toBe(auditActions.length);
  });
});
