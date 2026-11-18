import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_PATIENT } from '@/modules/seed/seed.data.js';
import { anyText, as, buildUsersApp, HOUR, login, registration } from './support/users.js';

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
      'Bruno Lima',
      'Carla Dias',
    ]);
    expect((await list('pageSize=2&role=patient')).total).toBe(4);
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

describe('example patient', () => {
  it('can be edited, promoted and deactivated like any account', async () => {
    const context = await withAdmin();
    await context.modules.users.service.ensureAccount(EXAMPLE_PATIENT);
    const example = await login(context.app, { email: EXAMPLE_PATIENT.email, password: EXAMPLE_PATIENT.password });
    const id = (example.body as { user: { id: string } }).user.id;

    const edited = await call(context, context.admin.token, 'patch', `/api/admin/users/${id}`, {
      fullName: 'Outro Nome',
    });
    const promoted = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/roles/admin`);
    const deactivated = await call(context, context.admin.token, 'post', `/api/admin/users/${id}/deactivate`);

    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ fullName: 'Outro Nome' });
    expect(edited.body).not.toHaveProperty('isProtected');
    expect(promoted.status).toBe(200);
    expect(deactivated.status).toBe(200);
    await login(context.app, { email: EXAMPLE_PATIENT.email, password: EXAMPLE_PATIENT.password }).expect(403);
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
      fields: { registryNumber: anyText },
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
    const session = ((await login(context.app).expect(200)).body as { token: string }).token;
    await context.auth.authenticate(session);
    const { specialtyId, unitId } = await catalog(context, context.admin.token);
    const path = `/api/admin/users/${id}/doctor-profile`;
    await call(context, context.admin.token, 'post', path, {
      specialtyId,
      unitId,
      registryNumber: '123456',
      registryUf: 'SP',
    }).expect(201);
    expect((await context.auth.authenticate(session))?.user.roles).toEqual(['doctor', 'patient']);

    const updated = await call(context, context.admin.token, 'patch', path, { registryNumber: '654321' });
    const removed = await call(context, context.admin.token, 'delete', path);

    expect(updated.body).toMatchObject({ doctorProfile: { registryNumber: '654321' } });
    expect(removed.body).toMatchObject({ roles: ['patient'], doctorProfile: null });
    expect((await context.auth.authenticate(session))?.user.roles).toEqual(['patient']);
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

describe('POST /api/admin/users', () => {
  const person = { fullName: 'Carla Mendes', email: 'carla.mendes@email.com', phone: '(11) 98765-4321' };
  const create = (context: Context, body: object, token = context.admin.token) =>
    call(context, token, 'post', '/api/admin/users', body);
  const accountsWith = async (context: Context, email: string) =>
    (await context.db.execute(sql`select 1 from users where email = ${email}`)).rows.length;

  async function doctorProfile(context: Context) {
    return { ...(await catalog(context, context.admin.token)), registryNumber: '123456', registryUf: 'SP' };
  }

  async function welcomeToken(context: Context) {
    await context.mail.drain();
    const message = context.mailer.sent.at(-1);
    const token = /\/redefinir-senha#token=([A-Za-z0-9_-]{43})/.exec(message?.text ?? '')?.[1];
    if (!token) throw new Error('No welcome link was sent');
    return { message, token };
  }

  const setPassword = (context: Context, token: string) =>
    request(context.app)
      .post('/api/password-reset/confirm')
      .send({ token, password: 'minha-senha-123', passwordConfirmation: 'minha-senha-123' });

  it('registers a patient with the same shape as the detail route, audited and without notices', async () => {
    const context = await withAdmin();

    const response = await create(context, { ...person, role: 'patient' });

    expect(response.status).toBe(201);
    const { id } = response.body as { id: string };
    expect(response.body).toEqual((await call(context, context.admin.token, 'get', `/api/admin/users/${id}`)).body);
    expect(response.body).toMatchObject({
      ...person,
      phone: '+5511987654321',
      roles: ['patient'],
      deactivatedAt: null,
      doctorProfile: null,
    });
    const audit = await context.db.execute<{ action: string; actor_id: string; metadata: unknown }>(
      sql`select action, actor_id, metadata from audit_logs where entity_id = ${id}`,
    );
    expect(audit.rows).toEqual([{ action: 'user.created', actor_id: context.admin.id, metadata: { role: 'patient' } }]);
    const notices = await context.db.execute<{ total: number }>(
      sql`select count(*)::int as total from notifications where params->>'userId' = ${id}`,
    );
    expect(notices.rows[0]?.total).toBe(0);
  });

  it('registers an admin on top of the patient role, recording who granted it', async () => {
    const context = await withAdmin();

    const response = await create(context, { ...person, phone: '', role: 'admin' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ phone: null, roles: ['admin', 'patient'] });
    const granted = await context.db.execute<{ role: string; granted_by: string }>(
      sql`select role, granted_by from user_roles
          where user_id = ${(response.body as { id: string }).id} order by role`,
    );
    expect(granted.rows).toEqual([
      { role: 'admin', granted_by: context.admin.id },
      { role: 'patient', granted_by: context.admin.id },
    ]);
  });

  it('registers a doctor with the profile in one step', async () => {
    const context = await withAdmin();
    const profile = await doctorProfile(context);

    const response = await create(context, {
      ...person,
      role: 'doctor',
      doctorProfile: { ...profile, registryUf: 'sp' },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      roles: ['doctor', 'patient'],
      doctorProfile: { council: 'CRM', registryUf: 'SP', specialtyName: 'Cardiologia', unitName: 'Unidade Central' },
    });
    const audit = await context.db.execute<{ metadata: unknown }>(
      sql`select metadata from audit_logs where action = 'user.created'`,
    );
    expect(audit.rows).toEqual([
      { metadata: { role: 'doctor', specialtyId: profile.specialtyId, unitId: profile.unitId } },
    ]);
  });

  it('requires the doctor profile only for doctors and validates it like the profile route', async () => {
    const context = await withAdmin();
    const profile = await doctorProfile(context);

    const missing = await create(context, { ...person, role: 'doctor' });
    const notDoctor = await create(context, { ...person, role: 'patient', doctorProfile: profile });
    const badRegistry = await create(context, {
      ...person,
      role: 'doctor',
      doctorProfile: { ...profile, registryNumber: '0123' },
    });
    const badRole = await create(context, { ...person, role: 'nurse' });
    const badFields = await create(context, { fullName: 'A', email: 'nao-e-email', role: 'patient' });

    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ fields: { doctorProfile: anyText } });
    expect(notDoctor.status).toBe(400);
    expect(notDoctor.body).toMatchObject({ fields: { doctorProfile: anyText } });
    expect(badRegistry.body).toMatchObject({ fields: { 'doctorProfile.registryNumber': anyText } });
    expect(badRole.body).toMatchObject({ fields: { role: anyText } });
    expect(badFields.body).toMatchObject({ fields: { fullName: anyText, email: anyText } });
    expect(await accountsWith(context, person.email)).toBe(0);
  });

  it('rolls everything back when the specialty or unit is unavailable', async () => {
    const context = await withAdmin();
    const profile = await doctorProfile(context);
    const unknownSpecialty = await create(context, {
      ...person,
      role: 'doctor',
      doctorProfile: { ...profile, specialtyId: randomUUID() },
    });
    await call(context, context.admin.token, 'patch', `/api/admin/units/${profile.unitId}`, { isActive: false });

    const response = await create(context, { ...person, role: 'doctor', doctorProfile: profile });
    await context.mail.drain();

    expect(unknownSpecialty.status).toBe(422);
    expect(unknownSpecialty.body).toMatchObject({
      code: 'SPECIALTY_UNAVAILABLE',
      fields: { 'doctorProfile.specialtyId': anyText },
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'UNIT_UNAVAILABLE', fields: { 'doctorProfile.unitId': anyText } });
    expect(await accountsWith(context, person.email)).toBe(0);
    expect(context.mailer.sent).toHaveLength(0);
  });

  it('refuses a registry that already belongs to another doctor', async () => {
    const context = await withAdmin();
    const profile = await doctorProfile(context);
    await create(context, { ...person, role: 'doctor', doctorProfile: profile }).expect(201);

    const response = await create(context, {
      ...person,
      email: 'bruno@email.com',
      role: 'doctor',
      doctorProfile: profile,
    });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'REGISTRY_TAKEN',
      fields: { 'doctorProfile.registryNumber': anyText },
    });
    expect(await accountsWith(context, 'bruno@email.com')).toBe(0);
  });

  it('answers EMAIL_TAKEN for an e-mail already in use, whatever the case', async () => {
    const context = await withAdmin();
    await register(context);

    const duplicate = await create(context, { ...person, email: ' ANA.Silva@Email.COM ', role: 'patient' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      message: 'Este e-mail já está cadastrado.',
      code: 'EMAIL_TAKEN',
      fields: { email: 'Este e-mail já está cadastrado.' },
    });
  });

  it('e-mails a link that creates the password, and login fails until then', async () => {
    const context = await withAdmin();
    const { id } = (await create(context, { ...person, role: 'patient' }).expect(201)).body as { id: string };

    const { message, token } = await welcomeToken(context);
    const guessed = await login(context.app, { email: person.email, password: 'qualquer-senha' });

    expect(message).toMatchObject({ to: person.email, subject: 'Sua conta no Saúde+ foi criada' });
    expect(message?.text).toContain('https://app.saudemais.test/redefinir-senha#token=');
    expect(message?.text).toContain('72 horas');
    expect(guessed.status).toBe(401);
    expect(guessed.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos.' });
    const stored = await context.db.execute<{ requested_by: string; hours: number }>(
      sql`select requested_by, extract(epoch from expires_at - created_at)::int / 3600 as hours
          from password_reset_tokens where user_id = ${id}`,
    );
    expect(stored.rows).toEqual([{ requested_by: context.admin.id, hours: 72 }]);

    await setPassword(context, token).expect(204);
    expect((await login(context.app, { email: person.email, password: 'minha-senha-123' })).status).toBe(200);
    expect((await setPassword(context, token)).status).toBe(400);
  });

  it('lets the welcome link expire after 72 hours', async () => {
    const context = await withAdmin();
    await create(context, { ...person, role: 'patient' }).expect(201);
    const { token } = await welcomeToken(context);

    context.clock.advance(72 * HOUR);

    expect((await setPassword(context, token)).body).toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('is only for active admins', async () => {
    const context = await withAdmin();
    await register(context);
    const patient = ((await login(context.app).expect(200)).body as { token: string }).token;
    const formerAdminId = await register(context, { email: 'ex.admin@email.com' });

    const anonymous = await request(context.app).post('/api/admin/users').send({ ...person, role: 'patient' });

    expect(anonymous.status).toBe(401);
    expect((await create(context, { ...person, role: 'patient' }, patient)).status).toBe(403);
    await expect(
      context.modules.adminUsers.service.create(
        { actorId: formerAdminId, ip: null },
        { fullName: person.fullName, email: person.email, phone: undefined, role: 'admin' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await context.mail.drain();
    expect(await accountsWith(context, person.email)).toBe(0);
    expect(context.mailer.sent.map((message) => message.to)).not.toContain(person.email);
  });
});
