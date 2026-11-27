import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { anyText, as, buildUsersApp, login, registerAndLogin, HOUR } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const MISSING = '00000000-0000-7000-8000-000000000000';
const DAY = 24 * HOUR;

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: string;
  audienceRoles: string[];
  startsAt: string;
  endsAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AdminPage {
  items: Announcement[];
  page: number;
  pageSize: number;
  total: number;
}

type Context = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN);
  const session = (await login(context.app, ADMIN).expect(200)).body as { token: string; user: { id: string } };
  const patient = await registerAndLogin(context.app);
  return { ...context, admin: session.token, adminId: session.user.id, patient };
}

let context: Context;

const iso = (offset: number) => new Date(context.clock.now().getTime() + offset).toISOString();

const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object, token = context.admin) => {
  const pending = request(context.app)[method](path).set(as(token));
  return body ? pending.send(body) : pending;
};

const draft = (overrides: object = {}) => ({
  title: 'Manutenção programada',
  body: 'O sistema ficará fora do ar no sábado, das 2h às 4h.',
  audienceRoles: ['patient', 'doctor'],
  ...overrides,
});

const create = async (overrides: object = {}) =>
  (await call('post', '/api/admin/announcements', draft(overrides)).expect(201)).body as Announcement;

const clear = () => context.db.execute(sql`delete from announcements`);

const adminList = async (query = '') => (await call('get', `/api/admin/announcements${query}`).expect(200)).body as AdminPage;

const visible = async (role: string, token = context.admin) =>
  (await call('get', `/api/announcements?role=${role}`, undefined, token).expect(200)).body as {
    items: { id: string; title: string; body: string; severity: string; startsAt: string; endsAt: string | null }[];
  };

const audited = async (action: string) =>
  (
    await context.db.execute<{ actor_id: string; entity_type: string; entity_id: string; metadata: unknown }>(
      sql`select actor_id, entity_type, entity_id, metadata from audit_logs where action = ${action} order by id`,
    )
  ).rows;

beforeAll(async () => {
  context = await setup();
}, 60_000);

describe('announcement administration', () => {
  it.each([
    ['get', '/api/admin/announcements'],
    ['post', '/api/admin/announcements'],
    ['patch', `/api/admin/announcements/${MISSING}`],
    ['delete', `/api/admin/announcements/${MISSING}`],
  ] as const)('keeps %s %s for administrators only', async (method, path) => {
    await request(context.app)[method](path).expect(401);
    expect((await call(method, path, method === 'post' || method === 'patch' ? draft() : undefined, context.patient)).status).toBe(
      403,
    );
  });

  it('creates an announcement that starts now, with severity info by default, and audits it', async () => {
    await clear();

    const created = await create();

    expect(created).toEqual({
      id: anyText,
      title: 'Manutenção programada',
      body: 'O sistema ficará fora do ar no sábado, das 2h às 4h.',
      severity: 'info',
      audienceRoles: ['patient', 'doctor'],
      startsAt: iso(0),
      endsAt: null,
      status: 'active',
      createdAt: anyText,
      updatedAt: anyText,
    });
    expect(await audited('announcement.created')).toEqual([
      {
        actor_id: context.adminId,
        entity_type: 'announcement',
        entity_id: created.id,
        metadata: {
          title: 'Manutenção programada',
          severity: 'info',
          audienceRoles: 'patient,doctor',
          startsAt: iso(0),
          endsAt: null,
        },
      },
    ]);
  });

  it('schedules an announcement with start and end', async () => {
    const created = await create({
      severity: 'warning',
      startsAt: iso(2 * HOUR),
      endsAt: iso(3 * HOUR),
      audienceRoles: ['admin'],
    });

    expect(created).toMatchObject({
      severity: 'warning',
      status: 'scheduled',
      startsAt: iso(2 * HOUR),
      endsAt: iso(3 * HOUR),
      audienceRoles: ['admin'],
    });
  });

  it.each([
    ['a blank title', { title: '   ' }, 'title'],
    ['a title over 80 characters', { title: 'x'.repeat(81) }, 'title'],
    ['a blank body', { body: '' }, 'body'],
    ['a body over 500 characters', { body: 'x'.repeat(501) }, 'body'],
    ['no audience', { audienceRoles: [] }, 'audienceRoles'],
    ['a repeated role', { audienceRoles: ['patient', 'patient'] }, 'audienceRoles'],
    ['an unknown role', { audienceRoles: ['nurse'] }, 'audienceRoles.0'],
    ['an unknown severity', { severity: 'fatal' }, 'severity'],
    ['an end before the start', { startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-01T10:00:00.000Z' }, 'endsAt'],
    ['an end equal to the start', { startsAt: '2026-12-02T10:00:00.000Z', endsAt: '2026-12-02T10:00:00.000Z' }, 'endsAt'],
    ['an invalid date', { startsAt: 'amanhã' }, 'startsAt'],
    ['an unknown field', { pinned: true }, '_root'],
  ])('refuses %s', async (_name, overrides, field) => {
    const response = await call('post', '/api/admin/announcements', draft(overrides));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { [field]: anyText } });
  });

  it('accepts titles and bodies at the limits', async () => {
    const created = await create({ title: 'x'.repeat(80), body: 'y'.repeat(500) });

    expect(created.title).toHaveLength(80);
    expect(created.body).toHaveLength(500);
  });

  it('lists newest first with the status filter and pages', async () => {
    await clear();
    const scheduled = await create({ title: 'Futuro', startsAt: iso(DAY) });
    const active = await create({ title: 'Ativo' });
    const ended = await create({ title: 'Encerrado', startsAt: iso(-2 * DAY), endsAt: iso(-DAY) });

    const all = await adminList();
    const titles = async (status: string) => (await adminList(`?status=${status}`)).items.map(({ title }) => title);

    expect(all).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(all.items.map(({ id }) => id)).toEqual([ended.id, active.id, scheduled.id]);
    expect(all.items.map(({ status }) => status)).toEqual(['ended', 'active', 'scheduled']);
    expect(await titles('scheduled')).toEqual(['Futuro']);
    expect(await titles('active')).toEqual(['Ativo']);
    expect(await titles('ended')).toEqual(['Encerrado']);
    expect((await adminList('?pageSize=2&page=2')).items.map(({ title }) => title)).toEqual(['Futuro']);
    expect((await call('get', '/api/admin/announcements?status=old')).status).toBe(400);
  });

  it('changes only the fields sent, stamps the update and audits the changed fields', async () => {
    const created = await create({ endsAt: iso(DAY) });
    context.clock.advance(HOUR);

    const response = await call('patch', `/api/admin/announcements/${created.id}`, {
      severity: 'critical',
      audienceRoles: ['patient'],
    }).expect(200);

    expect(response.body).toMatchObject({
      id: created.id,
      title: created.title,
      severity: 'critical',
      audienceRoles: ['patient'],
      endsAt: created.endsAt,
    });
    expect(Date.parse((response.body as Announcement).updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    expect((await audited('announcement.updated')).at(-1)).toMatchObject({
      entity_id: created.id,
      metadata: { fields: ['severity', 'audienceRoles'] },
    });
  });

  it('removes the end with null and reschedules the start', async () => {
    const created = await create({ endsAt: iso(DAY) });

    const response = await call('patch', `/api/admin/announcements/${created.id}`, {
      endsAt: null,
      startsAt: iso(HOUR),
    }).expect(200);

    expect(response.body).toMatchObject({ endsAt: null, startsAt: iso(HOUR), status: 'scheduled' });
  });

  it('refuses a change that leaves the end before the start', async () => {
    const created = await create({ endsAt: iso(DAY) });

    const earlier = await call('patch', `/api/admin/announcements/${created.id}`, { endsAt: iso(-HOUR) });
    const later = await call('patch', `/api/admin/announcements/${created.id}`, { startsAt: iso(2 * DAY) });

    expect([earlier.status, later.status]).toEqual([400, 400]);
    expect(earlier.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { endsAt: anyText } });
    expect(later.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { startsAt: anyText } });
  });

  it('refuses an empty change, an invalid value and an unknown announcement', async () => {
    const created = await create();

    expect((await call('patch', `/api/admin/announcements/${created.id}`, {})).status).toBe(400);
    expect((await call('patch', `/api/admin/announcements/${created.id}`, { title: ' ' })).status).toBe(400);
    expect((await call('patch', `/api/admin/announcements/abc`, { title: 'x' })).status).toBe(400);
    const missing = await call('patch', `/api/admin/announcements/${MISSING}`, { title: 'Novo' });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes an announcement and keeps its title in the audit log', async () => {
    const created = await create({ title: 'Para apagar' });

    await call('delete', `/api/admin/announcements/${created.id}`).expect(204);

    expect((await call('delete', `/api/admin/announcements/${created.id}`)).status).toBe(404);
    expect((await audited('announcement.deleted')).at(-1)).toMatchObject({
      entity_id: created.id,
      metadata: { title: 'Para apagar' },
    });
    expect((await adminList()).items.map(({ id }) => id)).not.toContain(created.id);
  });

  it.each([
    ['title', 'announcements_title_check', sql`update announcements set title = '   '`],
    ['body', 'announcements_body_check', sql`update announcements set body = ''`],
    ['severity', 'announcements_severity_check', sql`update announcements set severity = 'fatal'`],
    ['ends_at', 'announcements_ends_at_check', sql`update announcements set ends_at = starts_at`],
    ['empty audience', 'announcements_audience_roles_check', sql`update announcements set audience_roles = '{}'`],
    ['unknown role', 'announcements_audience_roles_check', sql`update announcements set audience_roles = '{nurse}'`],
  ])('keeps a bad %s out of the database too', async (_name, constraint, statement) => {
    await create();

    await expect(context.db.execute(statement)).rejects.toMatchObject({ cause: { constraint } });
  });
});

describe('announcements shown to people', () => {
  it('needs a role the account has', async () => {
    await call('get', '/api/announcements').expect(400);
    expect((await call('get', '/api/announcements?role=doctor', undefined, context.patient)).status).toBe(403);
    expect((await call('get', '/api/announcements?role=nurse')).status).toBe(400);
    await request(context.app).get('/api/announcements?role=patient').expect(401);
    await visible('patient', context.patient);
    await visible('admin');
  });

  it('shows what is active now to the role, without the audience or authors', async () => {
    await clear();
    const mine = await create({ title: 'Para pacientes', audienceRoles: ['patient'] });
    await create({ title: 'Para médicos', audienceRoles: ['doctor'] });
    await create({ title: 'Futuro', startsAt: iso(HOUR) });
    await create({ title: 'Encerrado', startsAt: iso(-2 * HOUR), endsAt: iso(-HOUR) });

    const { items } = await visible('patient', context.patient);

    expect(items).toEqual([
      { id: mine.id, title: 'Para pacientes', body: mine.body, severity: 'info', startsAt: iso(0), endsAt: null },
    ]);
  });

  it('follows the clock: starts when its time comes and stops at the end', async () => {
    await clear();
    await create({ title: 'Janela', startsAt: iso(HOUR), endsAt: iso(2 * HOUR) });
    const titles = async () => (await visible('patient', context.patient)).items.map(({ title }) => title);

    expect(await titles()).toEqual([]);
    context.clock.advance(HOUR - 1);
    expect(await titles()).toEqual([]);
    context.clock.advance(1);
    expect(await titles()).toEqual(['Janela']);
    context.clock.advance(HOUR - 1);
    expect(await titles()).toEqual(['Janela']);
    context.clock.advance(1);
    expect(await titles()).toEqual([]);
  });

  it('shows at most 5, critical first and then the newest start', async () => {
    await clear();
    await create({ title: 'Info antiga', startsAt: iso(-6 * HOUR), audienceRoles: ['patient'] });
    await create({ title: 'Info 1', startsAt: iso(-5 * HOUR), audienceRoles: ['patient'] });
    await create({ title: 'Info 2', startsAt: iso(-4 * HOUR), audienceRoles: ['patient'] });
    await create({ title: 'Aviso', severity: 'warning', startsAt: iso(-3 * HOUR), audienceRoles: ['patient'] });
    await create({ title: 'Crítico antigo', severity: 'critical', startsAt: iso(-9 * HOUR), audienceRoles: ['patient'] });
    await create({ title: 'Crítico novo', severity: 'critical', startsAt: iso(-HOUR), audienceRoles: ['patient'] });
    await create({ title: 'Info 3', startsAt: iso(-2 * HOUR), audienceRoles: ['patient'] });

    const { items } = await visible('patient', context.patient);

    expect(items.map(({ title }) => title)).toEqual([
      'Crítico novo',
      'Crítico antigo',
      'Info 3',
      'Aviso',
      'Info 2',
    ]);
  });

  it('is not served from cache', async () => {
    const response = await call('get', '/api/announcements?role=patient', undefined, context.patient);

    expect(response.headers['cache-control']).toBe('no-store');
  });
});
