import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { as, buildUsersApp, login, registerAndLogin } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

type Context = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN);
  const admin = ((await login(context.app, ADMIN).expect(200)).body as { token: string }).token;
  const patient = await registerAndLogin(context.app);
  return { ...context, admin, patient };
}

let context: Context;

beforeAll(async () => {
  context = await setup();
}, 60_000);

const adminCall = (method: 'get' | 'post' | 'patch' | 'put', path: string, body?: object) => {
  const call = request(context.app)[method](path).set(as(context.admin));
  return body ? call.send(body) : call;
};

const unitBody = (name: string, overrides: object = {}) => ({
  name,
  address: 'Rua das Flores, 123 - Centro',
  phone: '(11) 3333-4444',
  hours: [
    { weekday: 1, openMin: 480, closeMin: 1080 },
    { weekday: 0, openMin: 480, closeMin: 720 },
  ],
  ...overrides,
});

const examBody = (code: string, name: string, overrides: object = {}) => ({
  code,
  name,
  kind: 'lab',
  durationMin: 15,
  ...overrides,
});

describe('access', () => {
  it.each(['/api/admin/specialties', '/api/admin/units', '/api/admin/exam-types', '/api/admin/policy'])(
    'GET %s is for admins only',
    async (path) => {
      expect((await request(context.app).get(path)).status).toBe(401);
      expect((await request(context.app).get(path).set(as(context.patient))).status).toBe(403);
      expect((await request(context.app).get(path).set(as(context.admin))).status).toBe(200);
    },
  );

  it('refuses writes from patients', async () => {
    const response = await request(context.app)
      .post('/api/admin/specialties')
      .set(as(context.patient))
      .send({ name: 'Dermatologia', council: 'CRM' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each(['/api/specialties', '/api/units', '/api/exam-types'])('GET %s needs a session of any role', async (path) => {
    expect((await request(context.app).get(path)).status).toBe(401);
    expect((await request(context.app).get(path).set(as(context.patient))).status).toBe(200);
  });
});

describe('specialties', () => {
  it('creates with the council in upper case and a 30-minute default', async () => {
    const response = await adminCall('post', '/api/admin/specialties', { name: 'Cardiologia', council: 'crm' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Cardiologia',
      council: 'CRM',
      appointmentDurationMin: 30,
      isActive: true,
    });
  });

  it('refuses a name already used, regardless of case', async () => {
    await adminCall('post', '/api/admin/specialties', { name: 'Nutrição', council: 'CRN' }).expect(201);

    const response = await adminCall('post', '/api/admin/specialties', { name: 'NUTRIÇÃO', council: 'CRN' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'NAME_TAKEN', fields: { name: expect.any(String) as unknown } });
  });

  it.each([
    ['a short name', { name: 'A', council: 'CRM' }, 'name'],
    ['a short council', { name: 'Psicologia', council: 'cr' }, 'council'],
    [
      'a duration that is not a multiple of 5',
      { name: 'Psicologia', council: 'CRP', appointmentDurationMin: 33 },
      'appointmentDurationMin',
    ],
    [
      'a duration over 240 minutes',
      { name: 'Psicologia', council: 'CRP', appointmentDurationMin: 245 },
      'appointmentDurationMin',
    ],
  ])('rejects %s', async (_case, body, field) => {
    const response = await adminCall('post', '/api/admin/specialties', body);

    expect(response.status).toBe(400);
    expect((response.body as { fields: Record<string, string> }).fields).toHaveProperty(field);
  });

  it('leaves inactive specialties out of the list for booking, but not out of the admin list', async () => {
    const created = await adminCall('post', '/api/admin/specialties', { name: 'Ortopedia', council: 'CRM' }).expect(
      201,
    );
    const id = (created.body as { id: string }).id;

    await adminCall('patch', `/api/admin/specialties/${id}`, { isActive: false }).expect(200);

    const active = await request(context.app).get('/api/specialties').set(as(context.patient));
    const all = await adminCall('get', '/api/admin/specialties?pageSize=50');
    expect((active.body as { name: string }[]).map((item) => item.name)).not.toContain('Ortopedia');
    expect((all.body as { items: { name: string; isActive: boolean }[] }).items).toContainEqual(
      expect.objectContaining({ name: 'Ortopedia', isActive: false }),
    );
  });

  it('answers 404 for an unknown id and 400 for a malformed one', async () => {
    expect(
      (await adminCall('patch', '/api/admin/specialties/00000000-0000-7000-8000-000000000000', { isActive: true }))
        .status,
    ).toBe(404);
    expect((await adminCall('patch', '/api/admin/specialties/abc', { isActive: true })).status).toBe(400);
  });

  it('refuses an empty change', async () => {
    const created = await adminCall('post', '/api/admin/specialties', { name: 'Pediatria', council: 'CRM' }).expect(
      201,
    );

    expect((await adminCall('patch', `/api/admin/specialties/${(created.body as { id: string }).id}`, {})).status).toBe(
      400,
    );
  });
});

describe('units and hours', () => {
  it('creates a unit with a normalized phone and its hours ordered by weekday', async () => {
    const response = await adminCall('post', '/api/admin/units', unitBody('Unidade Central'));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      phone: '+551133334444',
      hours: [
        { weekday: 0, openMin: 480, closeMin: 720 },
        { weekday: 1, openMin: 480, closeMin: 1080 },
      ],
    });
  });

  it.each([
    ['closing before opening', { hours: [{ weekday: 1, openMin: 600, closeMin: 600 }] }],
    [
      'the same day twice',
      {
        hours: [
          { weekday: 1, openMin: 480, closeMin: 600 },
          { weekday: 1, openMin: 700, closeMin: 800 },
        ],
      },
    ],
    ['a weekday out of range', { hours: [{ weekday: 7, openMin: 480, closeMin: 600 }] }],
    ['minutes that are not multiples of 5', { hours: [{ weekday: 1, openMin: 482, closeMin: 600 }] }],
    ['an invalid phone', { phone: '123' }],
  ])('rejects %s', async (_case, overrides) => {
    expect((await adminCall('post', '/api/admin/units', unitBody('Unidade Inválida', overrides))).status).toBe(400);
  });

  it('replaces every hour when hours are sent', async () => {
    const created = await adminCall('post', '/api/admin/units', unitBody('Unidade Norte')).expect(201);

    const response = await adminCall('patch', `/api/admin/units/${(created.body as { id: string }).id}`, {
      hours: [{ weekday: 6, openMin: 540, closeMin: 780 }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: 'Unidade Norte',
      hours: [{ weekday: 6, openMin: 540, closeMin: 780 }],
    });
  });
});

describe('exam types and offers', () => {
  it('refuses a code already used', async () => {
    await adminCall('post', '/api/admin/exam-types', examBody('glicemia', 'Glicemia')).expect(201);

    const response = await adminCall('post', '/api/admin/exam-types', examBody('glicemia', 'Glicemia em jejum'));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CODE_TAKEN' });
  });

  it('rejects an unknown kind and an invalid code', async () => {
    expect(
      (await adminCall('post', '/api/admin/exam-types', examBody('raio_x', 'Raio-X', { kind: 'xray' }))).status,
    ).toBe(400);
    expect((await adminCall('post', '/api/admin/exam-types', examBody('Raio X', 'Raio-X'))).status).toBe(400);
  });

  it('offers an exam in a unit and lists only units that offer it', async () => {
    const unit = (await adminCall('post', '/api/admin/units', unitBody('Unidade Sul')).expect(201)).body as {
      id: string;
    };
    await adminCall('post', '/api/admin/units', unitBody('Unidade Leste')).expect(201);
    const exam = (await adminCall('post', '/api/admin/exam-types', examBody('hemograma', 'Hemograma')).expect(201))
      .body as { id: string };

    const saved = await adminCall('put', `/api/admin/units/${unit.id}/exam-offers/${exam.id}`, { capacityPerSlot: 3 });
    const units = await request(context.app).get(`/api/units?examTypeId=${exam.id}`).set(as(context.patient));

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual([
      { examTypeId: exam.id, examTypeName: 'Hemograma', capacityPerSlot: 3, isActive: true },
    ]);
    expect((units.body as { name: string }[]).map((item) => item.name)).toEqual(['Unidade Sul']);

    await adminCall('put', `/api/admin/units/${unit.id}/exam-offers/${exam.id}`, {
      capacityPerSlot: 3,
      isActive: false,
    });
    const afterDeactivation = await request(context.app)
      .get(`/api/units?examTypeId=${exam.id}`)
      .set(as(context.patient));
    expect(afterDeactivation.body).toEqual([]);
  });

  it('answers 404 for an unknown unit or exam type and 400 for capacity out of range', async () => {
    const unit = (await adminCall('post', '/api/admin/units', unitBody('Unidade Oeste')).expect(201)).body as {
      id: string;
    };
    const missing = '00000000-0000-7000-8000-000000000000';

    expect(
      (await adminCall('put', `/api/admin/units/${missing}/exam-offers/${missing}`, { capacityPerSlot: 1 })).status,
    ).toBe(404);
    expect(
      (await adminCall('put', `/api/admin/units/${unit.id}/exam-offers/${missing}`, { capacityPerSlot: 1 })).status,
    ).toBe(404);
    expect(
      (await adminCall('put', `/api/admin/units/${unit.id}/exam-offers/${missing}`, { capacityPerSlot: 51 })).status,
    ).toBe(400);
  });
});

describe('booking policy', () => {
  it('starts with the planned defaults', async () => {
    const response = await adminCall('get', '/api/admin/policy');

    expect(response.body).toMatchObject({
      appointmentLateWindowHours: 24,
      examLateWindowHours: 2,
      maxReschedules: 2,
      bookingHorizonDays: 60,
      minLeadMinutes: 60,
    });
  });

  it('saves every value at once and refuses values out of range', async () => {
    const policy = {
      appointmentLateWindowHours: 12,
      examLateWindowHours: 1,
      maxReschedules: 3,
      bookingHorizonDays: 90,
      minLeadMinutes: 120,
    };

    expect((await adminCall('put', '/api/admin/policy', policy)).body).toMatchObject(policy);
    expect((await adminCall('put', '/api/admin/policy', { ...policy, maxReschedules: 11 })).status).toBe(400);
    expect((await adminCall('put', '/api/admin/policy', { maxReschedules: 1 })).status).toBe(400);
  });
});

const idOf = (response: { body: unknown }) => (response.body as { id: string }).id;

describe('text limits', () => {
  it.each([
    ['a single emoji as the name', { name: '😀', council: 'CRM' }],
    ['an astral-plane character as the name', { name: '𠀀', council: 'CRM' }],
    ['a control character in the name', { name: 'Cardio\u0000logia', council: 'CRM' }],
  ])('refuses %s with a 400, not a database error', async (_case, body) => {
    const response = await adminCall('post', '/api/admin/specialties', body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR', fields: { name: expect.any(String) as unknown } });
  });

  it('counts the address by character, not by code unit', async () => {
    const response = await adminCall('post', '/api/admin/units', unitBody('Unidade Emoji', { address: '😀😀a' }));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ fields: { address: expect.any(String) as unknown } });
  });
});

describe('conflicts on change', () => {
  it('refuses renaming a specialty to a name already used', async () => {
    await adminCall('post', '/api/admin/specialties', { name: 'Neurologia', council: 'CRM' }).expect(201);
    const other = await adminCall('post', '/api/admin/specialties', { name: 'Geriatria', council: 'CRM' }).expect(201);

    const response = await adminCall('patch', `/api/admin/specialties/${idOf(other)}`, { name: 'NEUROLOGIA' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'NAME_TAKEN', fields: { name: expect.any(String) as unknown } });
  });

  it('refuses changing an exam code to one already used', async () => {
    await adminCall('post', '/api/admin/exam-types', examBody('glicemia_jejum', 'Glicemia em jejum')).expect(201);
    const other = await adminCall('post', '/api/admin/exam-types', examBody('tsh', 'TSH')).expect(201);

    const response = await adminCall('patch', `/api/admin/exam-types/${idOf(other)}`, { code: 'glicemia_jejum' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'CODE_TAKEN' });
  });

  it('clears the preparation notes when null is sent', async () => {
    const exam = await adminCall(
      'post',
      '/api/admin/exam-types',
      examBody('colesterol_total', 'Colesterol total', { preparationNotes: 'Jejum de 12 horas.' }),
    ).expect(201);

    const response = await adminCall('patch', `/api/admin/exam-types/${idOf(exam)}`, { preparationNotes: null });

    expect(response.body).toMatchObject({ preparationNotes: null });
  });
});

describe('inactive exam types', () => {
  it('cannot be offered and do not list the units that offered them', async () => {
    const unit = await adminCall('post', '/api/admin/units', unitBody('Unidade Ferritina')).expect(201);
    const exam = await adminCall('post', '/api/admin/exam-types', examBody('ferritina', 'Ferritina')).expect(201);
    const offerPath = `/api/admin/units/${idOf(unit)}/exam-offers/${idOf(exam)}`;
    await adminCall('put', offerPath, { capacityPerSlot: 2 }).expect(200);
    await adminCall('patch', `/api/admin/exam-types/${idOf(exam)}`, { isActive: false }).expect(200);

    const listed = await request(context.app)
      .get(`/api/units?examTypeId=${idOf(exam)}`)
      .set(as(context.patient));
    const reoffered = await adminCall('put', offerPath, { capacityPerSlot: 3 });
    const keptInactive = await adminCall('put', offerPath, { capacityPerSlot: 3, isActive: false });

    expect(listed.body).toEqual([]);
    expect(reoffered.status).toBe(409);
    expect(reoffered.body).toMatchObject({ code: 'EXAM_TYPE_INACTIVE' });
    expect(keptInactive.status).toBe(200);
  });
});

describe('pagination and audit', () => {
  it('limits the page size', async () => {
    for (const name of ['Unidade Página A', 'Unidade Página B', 'Unidade Página C']) {
      await adminCall('post', '/api/admin/units', unitBody(name)).expect(201);
    }

    expect((await adminCall('get', '/api/admin/units?pageSize=51')).status).toBe(400);
    const page = await adminCall('get', '/api/admin/units?page=1&pageSize=2');
    expect(page.body).toMatchObject({ page: 1, pageSize: 2, total: expect.any(Number) as unknown });
    expect((page.body as { items: unknown[]; total: number }).items).toHaveLength(2);
    expect((page.body as { total: number }).total).toBeGreaterThanOrEqual(3);
  });

  it('records who changed each record, without personal data', async () => {
    const specialty = await adminCall('post', '/api/admin/specialties', { name: 'Auditoria', council: 'CRM' }).expect(
      201,
    );
    await adminCall('patch', `/api/admin/specialties/${idOf(specialty)}`, { isActive: false }).expect(200);
    const unit = await adminCall('post', '/api/admin/units', unitBody('Unidade Auditoria')).expect(201);
    await adminCall('patch', `/api/admin/units/${idOf(unit)}`, { address: 'Avenida Paulista, 1000' }).expect(200);

    const rows = await context.db.execute<{ action: string; actor_type: string; has_actor: boolean }>(sql`
      select action, actor_type, actor_id is not null as has_actor, metadata from audit_logs
      where entity_id in (${idOf(specialty)}, ${idOf(unit)}) order by created_at
    `);

    expect(rows.rows.map((row) => row.action)).toEqual([
      'specialty.created',
      'specialty.deactivated',
      'unit.created',
      'unit.updated',
    ]);
    expect(rows.rows.every((row) => row.actor_type === 'user' && row.has_actor)).toBe(true);
    expect(JSON.stringify(rows.rows)).not.toContain('Paulista');
  });
});
