import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DoctorScheduleRepository } from '@/modules/doctor-schedule/doctor-schedule.repository.js';
import { DEFAULT_SCHEDULE, DoctorScheduleService } from '@/modules/doctor-schedule/doctor-schedule.service.js';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import { fixedClock } from './support/fixed-clock.js';
import { buildUsersApp, login, registerAndLogin, registration, START } from './support/users.js';

type Context = Awaited<ReturnType<typeof buildUsersApp>>;
type Range = { startMin: number; endMin: number };

const PATH = '/api/doctor/schedule';
const MORNING = { startMin: 480, endMin: 720 };
const AFTERNOON = { startMin: 780, endMin: 1020 };
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function week(ranges: Partial<Record<number, Range[]>>, inactive: number[] = []) {
  return {
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isActive: Boolean(ranges[weekday]?.length) && !inactive.includes(weekday),
      ranges: ranges[weekday] ?? [],
    })),
  };
}

async function withDoctor(): Promise<Context & { token: string; doctorId: string }> {
  const context = await buildUsersApp();
  await context.modules.demo.service.ensure();
  await registerAndLogin(context.app);
  await context.db.execute(sql`
    insert into doctor_profiles (user_id, specialty_id, council, unit_id, registry_number, registry_uf)
    select u.id, s.id, s.council, un.id, '12345', 'SP' from users u, specialties s, units un
    where u.email = 'ana.silva@email.com' and s.name = 'Clínica Geral' and un.name = 'Unidade Central'
  `);
  await context.db.execute(sql`
    insert into user_roles (user_id, role, granted_at) select id, 'doctor', now() from users
    where email = 'ana.silva@email.com'
  `);
  const body = (await login(context.app).expect(200)).body as { token: string; user: { id: string } };
  return { ...context, token: body.token, doctorId: body.user.id };
}

const save = (context: { app: Context['app']; token: string }, body: object) =>
  request(context.app).put(PATH).set(as(context.token)).send(body);

const read = (context: { app: Context['app']; token: string }) => request(context.app).get(PATH).set(as(context.token));

async function demoDoctorToken(context: Context) {
  const response = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password }).expect(200);
  return (response.body as { token: string }).token;
}

describe('access', () => {
  it('serves the schedule only to doctors', async () => {
    const context = await withDoctor();
    await request(context.app)
      .post('/api/users/register')
      .send(registration({ fullName: 'Paulo Souza', email: 'paulo@email.com' }))
      .expect(201);
    const patient = ((await login(context.app, { email: 'paulo@email.com' })).body as { token: string }).token;

    expect((await request(context.app).get(PATH)).status).toBe(401);
    expect((await request(context.app).get(PATH).set(as(patient))).status).toBe(403);
    expect((await request(context.app).put(PATH).set(as(patient)).send(week({}))).status).toBe(403);
    expect((await read(context)).status).toBe(200);
  });

  it('lets the demo doctor read the default schedule but never change it', async () => {
    const context = await buildUsersApp();
    await context.modules.demo.service.ensure();
    const token = await demoDoctorToken(context);

    const schedule = await read({ app: context.app, token });
    const attempt = await save({ app: context.app, token }, week({ 1: [MORNING] }));

    expect(schedule.status).toBe(200);
    expect((schedule.body as { days: unknown }).days).toEqual(DEFAULT_SCHEDULE);
    expect(attempt.status).toBe(403);
    expect(attempt.body).toMatchObject({ code: 'PROTECTED_ACCOUNT' });
  });

  it('answers 404 to a doctor without a doctor profile', async () => {
    const context = await buildUsersApp();
    await registerAndLogin(context.app);
    await context.db.execute(
      sql`insert into user_roles (user_id, role, granted_at) select id, 'doctor', now() from users`,
    );
    const token = ((await login(context.app)).body as { token: string }).token;

    const response = await read({ app: context.app, token });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('GET /api/doctor/schedule', () => {
  it('starts with every day inactive and shows the unit hours', async () => {
    const context = await withDoctor();

    const response = await read(context).expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      ...week({}),
      unitHours: [1, 2, 3, 4, 5]
        .map((weekday) => ({ weekday, openMin: 420, closeMin: 1140 }))
        .concat({ weekday: 6, openMin: 480, closeMin: 720 }),
    });
  });
});

describe('PUT /api/doctor/schedule', () => {
  it('replaces the whole week, sorting days and ranges, and keeps ranges of inactive days', async () => {
    const context = await withDoctor();
    await save(context, week({ 1: [MORNING], 2: [MORNING], 3: [MORNING] })).expect(200);
    const body = week({ 1: [AFTERNOON, MORNING], 6: [{ startMin: 480, endMin: 600 }] }, [6]);
    body.days.reverse();

    const response = await save(context, body).expect(200);

    const expected = week({ 1: [MORNING, AFTERNOON], 6: [{ startMin: 480, endMin: 600 }] }, [6]).days;
    expect(response.body).toMatchObject({ days: expected, warnings: [] });
    expect((await read(context)).body).toMatchObject({ days: expected });
  });

  it('accepts ranges that touch and records who changed the schedule', async () => {
    const context = await withDoctor();

    await save(context, week({ 1: [MORNING, { startMin: 720, endMin: 780 }] })).expect(200);

    const audit = await context.db.execute<{ action: string; actor_id: string }>(
      sql`select action, actor_id from audit_logs where action = 'doctor_schedule.saved'`,
    );
    expect(audit.rows).toEqual([{ action: 'doctor_schedule.saved', actor_id: context.doctorId }]);
  });

  it('refuses overlapping ranges with 422 OVERLAP and points at the range', async () => {
    const context = await withDoctor();

    const response = await save(context, week({ 2: [MORNING, { startMin: 700, endMin: 800 }] }));

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      code: 'OVERLAP',
      message: 'Esta faixa se sobrepõe a outra do mesmo dia.',
      fields: { 'days.2.ranges.1': 'Esta faixa se sobrepõe a outra do mesmo dia.' },
    });
  });

  it.each([
    ['before the unit opens', 1, { startMin: 360, endMin: 600 }],
    ['after the unit closes', 5, { startMin: 1080, endMin: 1200 }],
    ['on a day the unit is closed', 0, MORNING],
  ])('refuses a range %s with 422 OUTSIDE_UNIT_HOURS', async (_case, weekday, range) => {
    const context = await withDoctor();

    const response = await save(context, week({ [weekday]: [range] }));

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'OUTSIDE_UNIT_HOURS',
      fields: { [`days.${weekday}.ranges.0`]: 'Esta faixa fica fora do horário da unidade.' },
    });
  });

  it('keeps the previous schedule when a save is refused', async () => {
    const context = await withDoctor();
    await save(context, week({ 1: [MORNING] })).expect(200);

    await save(context, week({ 1: [AFTERNOON], 0: [MORNING] })).expect(422);

    expect((await read(context)).body).toMatchObject(week({ 1: [MORNING] }));
  });

  it.each([
    ['a range past midnight', week({ 1: [{ startMin: 1200, endMin: 1441 }] })],
    ['a range that ends before it starts', week({ 1: [{ startMin: 600, endMin: 600 }] })],
    ['a negative start', week({ 1: [{ startMin: -10, endMin: 600 }] })],
    ['six days', { days: week({}).days.slice(1) }],
    ['a repeated day', { days: [...week({}).days.slice(1), { weekday: 1, isActive: false, ranges: [] }] }],
    [
      'too many ranges in a day',
      week({ 1: Array.from({ length: 13 }, (_, i) => ({ startMin: i * 60, endMin: i * 60 + 30 })) }),
    ],
  ])('rejects %s with 400', async (_case, body) => {
    const context = await withDoctor();

    const response = await save(context, body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('atomic replace', () => {
  it('rolls back the whole save when the database refuses overlapping ranges', async () => {
    const context = await withDoctor();
    await save(context, week({ 1: [MORNING] })).expect(200);
    const repository = new DoctorScheduleRepository(context.db);

    await expect(
      repository.replace({
        doctorId: context.doctorId,
        days: week({ 2: [MORNING, { startMin: 600, endMin: 900 }] }).days,
        actor: { actorId: context.doctorId, ip: null },
        check: () => undefined,
      }),
    ).rejects.toThrow();

    expect((await read(context)).body).toMatchObject(week({ 1: [MORNING] }));
  });

  it('turns the exclusion constraint into 422 OVERLAP', async () => {
    const violation = Object.assign(new Error('conflicting key value'), {
      code: '23P01',
      constraint: 'doctor_schedule_ranges_no_overlap_excl',
    });
    const repository = { replace: () => Promise.reject(violation) } as unknown as DoctorScheduleRepository;
    const service = new DoctorScheduleService(repository, fixedClock(START));

    await expect(service.save('id', week({}), { actorId: 'id', ip: null })).rejects.toMatchObject({
      status: 422,
      code: 'OVERLAP',
    });
  });
});

describe('default schedule', () => {
  const totals = async (context: Context) => {
    const rows = await context.db.execute<{ days: number; ranges: number }>(sql`
      select (select count(*)::int from doctor_schedule_days) as days,
             (select count(*)::int from doctor_schedule_ranges) as ranges
    `);
    return rows.rows[0];
  };

  it('gives the demo and sample doctors Mon–Fri 08:00–12:00 and 13:00–17:00 once', async () => {
    const context = await buildUsersApp();

    await context.modules.demo.service.seed();
    await context.modules.demo.service.seed();

    expect(await totals(context)).toEqual({ days: 35, ranges: 50 });
  });

  it('never overwrites a schedule the doctor changed', async () => {
    const context = await buildUsersApp();
    await context.modules.demo.service.seed();
    await context.db.execute(sql`delete from doctor_schedule_ranges where weekday = 1`);
    await context.db.execute(sql`update doctor_schedule_days set is_active = false where weekday = 1`);

    await context.modules.demo.service.seed();
    await context.modules.demo.service.ensure();

    expect(await totals(context)).toEqual({ days: 35, ranges: 40 });
  });
});
