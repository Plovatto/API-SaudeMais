import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '@/modules/users/user.demo.js';
import { as, buildUsersApp, login, registration } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

async function adminSession(context: Awaited<ReturnType<typeof buildUsersApp>>, credentials = ADMIN) {
  const body = (await login(context.app, credentials).expect(200)).body as { token: string; user: { id: string } };
  return { token: body.token, id: body.user.id };
}

async function withAdmin() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN);
  return { ...context, admin: await adminSession(context) };
}

type Context = Awaited<ReturnType<typeof withAdmin>>;

async function register(context: { app: Context['app'] }, overrides: Record<string, unknown> = {}) {
  const created = await request(context.app).post('/api/users/register').send(registration(overrides)).expect(201);
  return (created.body as { id: string }).id;
}

const call = (
  context: { app: Context['app'] },
  token: string,
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  body?: object,
) => {
  const pending = request(context.app)[method](path).set(as(token));
  return body ? pending.send(body) : pending;
};

async function catalog(context: { app: Context['app'] }, token: string) {
  const specialty = await call(context, token, 'post', '/api/admin/specialties', {
    name: 'Cardiologia',
    council: 'CRM',
  });
  const unit = await call(context, token, 'post', '/api/admin/units', {
    name: 'Unidade Central',
    address: 'Rua das Flores, 123 - Centro',
    phone: '(11) 3333-4444',
    hours: [{ weekday: 1, openMin: 480, closeMin: 1080 }],
  });
  return { specialtyId: (specialty.body as { id: string }).id, unitId: (unit.body as { id: string }).id };
}

describe('access', () => {
  it('lets only admins list users', async () => {
    const context = await withAdmin();
    await register(context);
    const patient = ((await login(context.app).expect(200)).body as { token: string }).token;

    expect((await request(context.app).get('/api/admin/users')).status).toBe(401);
    expect((await call(context, patient, 'get', '/api/admin/users')).status).toBe(403);
    expect((await call(context, context.admin.token, 'get', '/api/admin/users')).status).toBe(200);
  });

  it('answers 404 for an unknown user', async () => {
    const context = await withAdmin();

    const response = await call(
      context,
      context.admin.token,
      'get',
      '/api/admin/users/0190f6a1-0000-7000-8000-000000000000',
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
  });
});

describe('GET /api/admin/users', () => {
  it('finds people by name without accents and escapes wildcards', async () => {
    const context = await withAdmin();
    await register(context, { fullName: 'José da Conceição', email: 'jose@email.com' });
    await register(context, { fullName: 'Maria 100% Silva', email: 'maria_s@email.com' });
    await register(context, { fullName: 'Mario Souza', email: 'mario@email.com' });
    const search = (term: string) =>
      call(context, context.admin.token, 'get', `/api/admin/users?search=${encodeURIComponent(term)}`);

    expect(((await search('conceicao')).body as { items: { email: string }[] }).items.map((u) => u.email)).toEqual([
      'jose@email.com',
    ]);
    expect(((await search('100%')).body as { total: number }).total).toBe(1);
    expect(((await search('maria_')).body as { total: number }).total).toBe(1);
    expect(((await search('_')).body as { total: number }).total).toBe(1);
  });

  it('filters by role and status and paginates in alphabetical order', async () => {
    const context = await withAdmin();
    for (const [name, email] of [
      ['Bruno Lima', 'bruno@email.com'],
      ['Carla Dias', 'carla@email.com'],
      ['Ana Prado', 'ana@email.com'],
    ]) {
      await register(context, { fullName: name, email });
    }
    const list = (query: string) =>
      call(context, context.admin.token, 'get', `/api/admin/users?${query}`).then(
        (response) => response.body as { items: { fullName: string }[]; total: number },
      );

    expect((await list('role=admin')).items.map((u) => u.fullName)).toEqual(['Administrador']);
    expect((await list('page=2&pageSize=2&role=patient')).items.map((u) => u.fullName)).toEqual([
      'Ana Prado',
      'Bruno Lima',
    ]);
    expect((await list('pageSize=2&role=patient')).total).toBe(5);
    expect((await list('status=inactive')).total).toBe(0);
  });

  it('never exposes password hashes', async () => {
    const context = await withAdmin();
    await register(context);

    const response = await call(context, context.admin.token, 'get', '/api/admin/users');

    expect(JSON.stringify(response.body)).not.toMatch(/password|scrypt/i);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('edit, deactivate and reactivate', () => {
  it('edits name and phone and records it in the audit log', async () => {
    const context = await withAdmin();
    const id = await register(context);

    const response = await call(context, context.admin.token, 'patch', `/api/admin/users/${id}`, {
      fullName: 'Ana Souza',
      phone: null,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ fullName: 'Ana Souza', phone: null, email: 'ana.silva@email.com' });
    const audit = await context.db.execute<{ action: string; metadata: unknown }>(
      sql`select action, metadata from audit_logs where entity_id = ${id}`,
    );
    expect(audit.rows).toEqual([{ action: 'user.updated', metadata: { fields: ['fullName', 'phone'] } }]);
  });

  it('deactivation ends the sessions and blocks login until reactivated', async () => {
    const context = await withAdmin();
    const id = await register(context);
    const session = ((await login(context.app).expect(200)).body as { token: string }).token;

    const deactivated = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/deactivate`);

    expect(deactivated.status).toBe(200);
    expect((deactivated.body as { deactivatedAt: string | null }).deactivatedAt).not.toBeNull();
    expect(await context.auth.authenticate(session)).toBeNull();
    expect((await login(context.app)).status).toBe(403);

    await call(context, context.admin.token, 'post', `/api/admin/users/${id}/reactivate`).expect(200);
    expect((await login(context.app)).status).toBe(200);
  });

  it('shows the impact before deactivating', async () => {
    const context = await withAdmin();
    const id = await register(context);

    const response = await call(context, context.admin.token, 'get', `/api/admin/users/${id}/deactivation-impact`);

    expect(response.body).toEqual({ futureAppointmentsAsPatient: 0, futureAppointmentsAsDoctor: 0 });
  });
});

describe('admins (RN-06)', () => {
  it('cannot deactivate or demote themselves', async () => {
    const context = await withAdmin();
    const self = `/api/admin/users/${context.admin.id}`;

    const deactivate = await call(context, context.admin.token, 'post', `${self}/deactivate`);
    const demote = await call(context, context.admin.token, 'delete', `${self}/roles/admin`);

    expect(deactivate.status).toBe(409);
    expect(demote.status).toBe(409);
    expect(demote.body).toMatchObject({ code: 'SELF_OR_LAST_ADMIN' });
  });

  it('lets an admin deactivate another admin while one stays active', async () => {
    const context = await withAdmin();
    const id = await register(context);
    await call(context, context.admin.token, 'post', `/api/admin/users/${id}/roles/admin`).expect(200);

    const response = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/deactivate`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ roles: ['admin', 'patient'] });
  });

  it('only grants the admin role through the roles route', async () => {
    const context = await withAdmin();
    const id = await register(context);

    const response = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/roles/doctor`);

    expect(response.status).toBe(400);
  });
});

describe('acting admin', () => {
  it('refuses a change from someone who is no longer an active admin', async () => {
    const context = await withAdmin();
    const targetId = await register(context);
    const formerAdminId = await register(context, { email: 'ex.admin@email.com' });

    await expect(
      context.modules.adminUsers.service.update({ actorId: formerAdminId, ip: null }, targetId, {
        fullName: 'Outro Nome',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(
      context.modules.adminUsers.service.sendPasswordReset({ actorId: formerAdminId, ip: null }, targetId),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('protected demo account', () => {
  it('cannot be edited, deactivated, promoted or sent a reset link', async () => {
    const context = await withAdmin();
    const demo = await login(context.app, { email: DEMO_ACCOUNTS[0]?.email, password: DEMO_ACCOUNTS[0]?.password });
    const id = (demo.body as { user: { id: string } }).user.id;

    for (const [method, path, body] of [
      ['patch', `/api/admin/users/${id}`, { fullName: 'Outro Nome' }],
      ['post', `/api/admin/users/${id}/deactivate`, undefined],
      ['post', `/api/admin/users/${id}/roles/admin`, undefined],
      ['post', `/api/admin/users/${id}/password-reset`, undefined],
    ] as const) {
      const response = await call(context, context.admin.token, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(response.body).toMatchObject({ code: 'PROTECTED_ACCOUNT' });
    }
  });
});

describe('doctor profile', () => {
  it('makes someone a doctor, copying the council from the specialty', async () => {
    const context = await withAdmin();
    const id = await register(context);
    const { specialtyId, unitId } = await catalog(context, context.admin.token);

    const response = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/doctor-profile`, {
      specialtyId,
      unitId,
      registryNumber: '123456',
      registryUf: 'sp',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      roles: ['doctor', 'patient'],
      doctorProfile: { council: 'CRM', registryUf: 'SP', specialtyName: 'Cardiologia', unitName: 'Unidade Central' },
    });
  });

  it('refuses a registry that already belongs to another doctor', async () => {
    const context = await withAdmin();
    const first = await register(context);
    const second = await register(context, { email: 'bruno@email.com' });
    const { specialtyId, unitId } = await catalog(context, context.admin.token);
    const profile = { specialtyId, unitId, registryNumber: '123456', registryUf: 'SP' };
    await call(context, context.admin.token, 'post', `/api/admin/users/${first}/doctor-profile`, profile).expect(201);

    const response = await call(
      context,
      context.admin.token,
      'post',
      `/api/admin/users/${second}/doctor-profile`,
      profile,
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'REGISTRY_TAKEN',
      fields: { registryNumber: expect.any(String) as unknown },
    });
  });

  it('refuses an inactive specialty or unit', async () => {
    const context = await withAdmin();
    const id = await register(context);
    const { specialtyId, unitId } = await catalog(context, context.admin.token);
    await call(context, context.admin.token, 'patch', `/api/admin/units/${unitId}`, { isActive: false }).expect(200);

    const response = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/doctor-profile`, {
      specialtyId,
      unitId,
      registryNumber: '123456',
      registryUf: 'SP',
    });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'UNIT_UNAVAILABLE' });
  });

  it('updates and removes the profile, keeping the doctor role in sync', async () => {
    const context = await withAdmin();
    const id = await register(context);
    const { specialtyId, unitId } = await catalog(context, context.admin.token);
    const path = `/api/admin/users/${id}/doctor-profile`;
    await call(context, context.admin.token, 'post', path, {
      specialtyId,
      unitId,
      registryNumber: '123456',
      registryUf: 'SP',
    }).expect(201);

    const updated = await call(context, context.admin.token, 'patch', path, { registryNumber: '654321' });
    const removed = await call(context, context.admin.token, 'delete', path);

    expect(updated.body).toMatchObject({ doctorProfile: { registryNumber: '654321' } });
    expect(removed.body).toMatchObject({ roles: ['patient'], doctorProfile: null });
    expect((await call(context, context.admin.token, 'delete', path)).status).toBe(404);
    expect((await call(context, context.admin.token, 'patch', path, { registryUf: 'RJ' })).status).toBe(404);
  });

  it('keeps the profile of a removed doctor for history and brings it back with the role', async () => {
    const context = await withAdmin();
    const id = await register(context);
    const otherId = await register(context, { email: 'bruno@email.com' });
    const { specialtyId, unitId } = await catalog(context, context.admin.token);
    const profile = { specialtyId, unitId, registryNumber: '123456', registryUf: 'SP' };
    const path = `/api/admin/users/${id}/doctor-profile`;
    await call(context, context.admin.token, 'post', path, profile).expect(201);
    await call(context, context.admin.token, 'delete', path).expect(200);

    const stillReserved = await call(
      context,
      context.admin.token,
      'post',
      `/api/admin/users/${otherId}/doctor-profile`,
      profile,
    );
    const restored = await call(context, context.admin.token, 'post', path, { ...profile, registryUf: 'RJ' });
    const rows = await context.db.execute<{ total: number }>(sql`select count(*)::int as total from doctor_profiles`);

    expect(stillReserved.status).toBe(409);
    expect(stillReserved.body).toMatchObject({ code: 'REGISTRY_TAKEN' });
    expect(restored.status).toBe(201);
    expect(restored.body).toMatchObject({ roles: ['doctor', 'patient'], doctorProfile: { registryUf: 'RJ' } });
    expect(rows.rows[0]?.total).toBe(1);
  });

  it('refuses changing the council of a specialty that has doctors', async () => {
    const context = await withAdmin();
    const id = await register(context);
    const { specialtyId, unitId } = await catalog(context, context.admin.token);
    await call(context, context.admin.token, 'post', `/api/admin/users/${id}/doctor-profile`, {
      specialtyId,
      unitId,
      registryNumber: '123456',
      registryUf: 'SP',
    }).expect(201);

    const response = await call(context, context.admin.token, 'patch', `/api/admin/specialties/${specialtyId}`, {
      council: 'CRN',
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'COUNCIL_IN_USE' });
  });
});

describe('POST /api/admin/users/:id/password-reset', () => {
  it('sends the link and records who asked for it', async () => {
    const context = await withAdmin();
    const id = await register(context);

    const response = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/password-reset`);
    await context.mail.drain();

    expect(response.status).toBe(202);
    expect(context.mailer.sent.at(-1)?.to).toBe('ana.silva@email.com');
    const tokens = await context.db.execute<{ requested_by: string }>(
      sql`select requested_by from password_reset_tokens`,
    );
    expect(tokens.rows).toEqual([{ requested_by: context.admin.id }]);
  });

  it('tells the admin when a link was sent too recently', async () => {
    const context = await withAdmin();
    const id = await register(context);
    await call(context, context.admin.token, 'post', `/api/admin/users/${id}/password-reset`).expect(202);

    const again = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/password-reset`);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'RESET_NOT_SENT' });
  });
});
