import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { activeFutureCounts, activeLimits } from '@/modules/bookings/bookings.repository.js';
import { EXAMPLE_DOCTOR, EXAMPLE_DOCTOR_PROFILE, EXAMPLE_PATIENT, SAMPLE_BOOKINGS } from '@/modules/seed/seed.data.js';
import { seedTarget } from '@/modules/seed/seed-guard.js';
import { as, buildUsersApp, HOUR, login } from './support/users.js';

const tables = [
  'users',
  'user_roles',
  'specialties',
  'units',
  'unit_hours',
  'exam_types',
  'unit_exam_offers',
  'doctor_profiles',
];

async function counts(db: Awaited<ReturnType<typeof buildUsersApp>>['db']) {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const rows = await db.execute<{ total: number }>(sql.raw(`select count(*)::int as total from ${table}`));
    result[table] = rows.rows[0]?.total ?? 0;
  }
  return result;
}

describe('sample data', () => {
  it('creates the example doctor with a doctor profile', async () => {
    const context = await buildUsersApp();

    await context.modules.seed.service.seed();

    const response = await login(context.app, { email: EXAMPLE_DOCTOR.email, password: EXAMPLE_DOCTOR.password });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { fullName: 'Dr. João Silveira', roles: ['doctor', 'patient'] } });
    const profile = await context.db.execute<{ council: string; registry_uf: string }>(sql`
      select council, registry_uf from doctor_profiles join users on users.id = user_id
      where email = ${EXAMPLE_DOCTOR.email}
    `);
    expect(profile.rows).toEqual([{ council: 'CRM', registry_uf: 'SP' }]);
  });

  it('seeds catalogs, doctors and patients without duplicating anything on a second run', async () => {
    const context = await buildUsersApp();

    await context.modules.seed.service.seed();
    const first = await counts(context.db);
    await context.modules.seed.service.seed();

    expect(await counts(context.db)).toEqual(first);
    expect(first).toMatchObject({
      specialties: 5,
      units: 2,
      unit_hours: 11,
      exam_types: 5,
      unit_exam_offers: 8,
      doctor_profiles: 5,
    });
  });

  it('runs again after the admin changed a sample account', async () => {
    const context = await buildUsersApp();
    await context.modules.seed.service.seed();
    await context.db.execute(sql`
      delete from user_roles where role = 'doctor'
        and user_id = (select id from users where email = 'ana.ferreira@saudemais.test')
    `);

    await expect(context.modules.seed.service.seed()).resolves.toEqual([]);
  });

  it('keeps a catalog item the admin already created under the same name', async () => {
    const context = await buildUsersApp();
    await context.db.execute(
      sql`insert into specialties (name, council, appointment_duration_min) values ('clínica geral', 'CRM', 45)`,
    );

    await context.modules.seed.service.seed();

    const rows = await context.db.execute<{ appointment_duration_min: number }>(
      sql`select appointment_duration_min from specialties where name = 'Clínica Geral'`,
    );
    expect(rows.rows).toEqual([{ appointment_duration_min: 45 }]);
  });

  it('adds no opening hours to a unit the admin already created', async () => {
    const context = await buildUsersApp();
    await context.db.execute(
      sql`insert into units (name, address, phone) values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000')`,
    );

    await expect(context.modules.seed.service.seed()).resolves.toEqual([]);

    expect(await counts(context.db)).toMatchObject({ units: 2, unit_hours: 5, doctor_profiles: 5 });
  });

  it('skips the example doctor profile with a warning when its unit was deactivated', async () => {
    const context = await buildUsersApp();
    await context.db.execute(sql`
      insert into units (name, address, phone, is_active)
      values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000', false)
    `);

    const warnings = await context.modules.seed.service.seed();

    expect(warnings).toHaveLength(3);
    for (const warning of warnings) expect(warning).toContain('Unidade Central is missing or inactive');
    expect(await counts(context.db)).toMatchObject({ doctor_profiles: 2, unit_hours: 5 });
    const response = await login(context.app, { email: EXAMPLE_DOCTOR.email, password: EXAMPLE_DOCTOR.password });
    expect(response.body).toMatchObject({ user: { roles: ['patient'] } });
  });

  it('grants neither the role nor the profile when the reserved registry is already taken', async () => {
    const context = await buildUsersApp();
    await context.db.execute(sql`
      with s as (
        insert into specialties (name, council, appointment_duration_min) values ('Cardiologia', 'CRM', 30) returning id
      ), u as (
        insert into units (name, address, phone) values ('Unidade Sul', 'Av. Ipiranga, 987', '+551155556666') returning id
      ), p as (
        insert into users (full_name, email, password_hash) values ('Outra Pessoa', 'outra@email.com', 'x') returning id
      )
      insert into doctor_profiles (user_id, specialty_id, council, unit_id, registry_number, registry_uf)
      select p.id, s.id, 'CRM', u.id, ${EXAMPLE_DOCTOR_PROFILE.registryNumber}, ${EXAMPLE_DOCTOR_PROFILE.registryUf}
      from p, s, u
    `);

    const warnings = await context.modules.seed.service.seed();

    expect(warnings).toEqual([expect.stringContaining('already in use')]);
    const response = await login(context.app, { email: EXAMPLE_DOCTOR.email, password: EXAMPLE_DOCTOR.password });
    expect(response.body).toMatchObject({ user: { roles: ['patient'] } });
  });

  it('gives sample doctor profiles only to accounts it created', async () => {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount({
      fullName: 'Ana Ferreira',
      email: 'ana.ferreira@saudemais.test',
      password: 'senha-propria-123',
      roles: ['patient'],
    });

    await context.modules.seed.service.seed();

    const rows = await context.db.execute<{ total: number }>(sql`
      select count(*)::int as total from doctor_profiles
      join users on users.id = user_id where email = 'ana.ferreira@saudemais.test'
    `);
    expect(rows.rows[0]?.total).toBe(0);
  });

  it('looks exam types up by code only', async () => {
    const context = await buildUsersApp();
    await context.db.execute(sql`
      insert into exam_types (code, name, kind, duration_min) values ('hemograma_completo', 'Hemograma', 'lab', 15)
    `);

    await context.modules.seed.service.seed();

    const rows = await context.db.execute<{ code: string }>(
      sql`select code from exam_types where code like 'hemograma%' order by code`,
    );
    expect(rows.rows).toEqual([{ code: 'hemograma_completo' }]);
  });
});

async function bookingsOf(db: Awaited<ReturnType<typeof buildUsersApp>>['db'], email: string) {
  const rows = await db.execute<{ kind: string; status: string }>(
    sql`select kind, status from bookings join users on users.id = bookings.patient_id where users.email = ${email}`,
  );
  return rows.rows.map(({ kind, status }) => `${kind}:${status}`).sort();
}

const exampleLogin = (context: Awaited<ReturnType<typeof buildUsersApp>>, password = EXAMPLE_PATIENT.password) =>
  login(context.app, { email: EXAMPLE_PATIENT.email, password });

describe('example accounts', () => {
  async function seeded() {
    const context = await buildUsersApp();
    await context.modules.seed.service.seed();
    return context;
  }

  it('creates the example patient once with its sample bookings, inside the active booking limit', async () => {
    const context = await seeded();
    const signedIn = await exampleLogin(context).expect(200);
    const { user, token } = signedIn.body as { user: { id: string }; token: string };
    const unread = await request(context.app)
      .get('/api/notifications/unread-count')
      .query({ role: 'patient' })
      .set(as(token))
      .expect(200);
    const results = SAMPLE_BOOKINGS.reduce(
      (total, seed) => total + (seed.kind === 'exam' ? (seed.results?.length ?? 0) : 0),
      0,
    );

    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toEqual([
      'appointment:completed',
      'appointment:completed',
      'appointment:confirmed',
      'appointment:confirmed',
      'appointment:pending',
      'exam:completed',
      'exam:confirmed',
    ]);
    expect(unread.body).toEqual({ count: results });
    const active = await activeFutureCounts(context.db, user.id, context.clock.now());
    const limits = await activeLimits(context.db);
    expect(active.appointment + active.exam).toBeLessThan(limits.maxActiveBookings);
    expect(active.appointment).toBeLessThan(limits.maxActiveAppointments);
    expect(active.exam).toBeLessThan(limits.maxActiveExams);

    context.clock.advance(24 * HOUR);
    await context.modules.seed.service.seed();

    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toHaveLength(SAMPLE_BOOKINGS.length);
  });

  it('never restores an example account the admin or its owner changed', async () => {
    const context = await seeded();
    const { token } = (await exampleLogin(context).expect(200)).body as { token: string };
    await request(context.app)
      .post('/api/me/password')
      .set(as(token))
      .send({
        currentPassword: EXAMPLE_PATIENT.password,
        password: 'nova-senha-456',
        passwordConfirmation: 'nova-senha-456',
      })
      .expect(204);
    await context.db.execute(sql`update users set full_name = 'Outro Nome' where email = ${EXAMPLE_PATIENT.email}`);
    await context.db.execute(sql`update users set deactivated_at = now() where email = ${EXAMPLE_DOCTOR.email}`);

    context.clock.advance(24 * HOUR);
    await context.modules.seed.service.seed();

    await exampleLogin(context).expect(401);
    const renamed = await exampleLogin(context, 'nova-senha-456').expect(200);
    expect(renamed.body).toMatchObject({ user: { fullName: 'Outro Nome' } });
    await request(context.app)
      .post('/api/users/login')
      .send({ email: EXAMPLE_DOCTOR.email, password: EXAMPLE_DOCTOR.password })
      .expect(403);
    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toHaveLength(SAMPLE_BOOKINGS.length);
  });

  it('leaves an account that already holds an example e-mail untouched and books nothing for it', async () => {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount({
      ...EXAMPLE_PATIENT,
      fullName: 'Pessoa Real',
      password: 'senha-real-123',
    });

    await context.modules.seed.service.seed();

    const response = await exampleLogin(context, 'senha-real-123').expect(200);
    expect(response.body).toMatchObject({ user: { fullName: 'Pessoa Real', roles: ['patient'] } });
    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toEqual([]);
  });

  it('blocks one future weekday for the example doctor only when it creates the doctor', async () => {
    const context = await seeded();
    const blockedDates = async () =>
      (
        await context.db.execute<{ date: string; reason: string | null }>(sql`
          select t.date::text as date, t.reason from doctor_time_off t join users u on u.id = t.doctor_id
          where u.email = ${EXAMPLE_DOCTOR.email}
        `)
      ).rows;
    const dates = await blockedDates();
    const [blocked] = dates;

    expect(dates).toHaveLength(1);
    expect(blocked?.reason).toBe('Congresso médico');
    expect((blocked?.date ?? '') > '2026-11-21').toBe(true);
    expect([0, 6]).not.toContain(new Date(`${blocked?.date ?? ''}T12:00:00Z`).getUTCDay());

    context.clock.advance(24 * HOUR);
    await context.modules.seed.service.seed();

    expect(await blockedDates()).toEqual(dates);
  });
});

describe('seedTarget', () => {
  const url = 'postgres://user:secret@db.internal:5432/saudemais';

  it('refuses production unless SEED_ALLOW_PRODUCTION is 1', () => {
    expect(() => seedTarget('production', url, undefined)).toThrow(/SEED_ALLOW_PRODUCTION/);
    expect(seedTarget('production', url, '1')).toBe('db.internal');
  });

  it('returns only the host of the target database', () => {
    expect(seedTarget('development', url, undefined)).toBe('db.internal');
  });

  it('accepts local and private databases outside production', () => {
    const hosts = [
      'localhost',
      '127.0.0.1',
      '[::1]',
      '[fd12:3456::1]',
      'postgres',
      '10.0.0.5',
      '172.20.0.2',
      '192.168.1.9',
      'db.local',
    ];

    for (const host of hosts) {
      expect(seedTarget('development', `postgres://u:p@${host}:5432/saudemais`, undefined)).toBe(host);
    }
  });

  it('refuses a remote database outside production unless SEED_ALLOW_REMOTE is 1', () => {
    const remote = 'postgres://u:p@ep-cool-name.sa-east-1.aws.neon.tech/saudemais';

    expect(() => seedTarget('development', remote, undefined)).toThrow(/SEED_ALLOW_REMOTE/);
    for (const host of ['172.32.0.1', '[2600:1f18::1]', '10.db.example.com', '127.example.com']) {
      expect(() => seedTarget('test', `postgres://u:p@${host}/db`, undefined)).toThrow(/SEED_ALLOW_REMOTE/);
    }
    expect(seedTarget('development', remote, undefined, '1')).toBe('ep-cool-name.sa-east-1.aws.neon.tech');
    expect(seedTarget('production', remote, '1')).toBe('ep-cool-name.sa-east-1.aws.neon.tech');
  });
});
