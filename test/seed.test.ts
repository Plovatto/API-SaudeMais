import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ACTIVE_LIMIT } from '@/modules/bookings/bookings.messages.js';
import { EXAMPLE_DOCTOR_PROFILE } from '@/modules/seed/seed.data.js';
import { seedTarget } from '@/modules/seed/seed-guard.js';
import { EXAMPLE_DOCTOR, EXAMPLE_PATIENT } from '@/modules/users/user.seed.js';
import { as, buildUsersApp, login } from './support/users.js';

type Context = Awaited<ReturnType<typeof buildUsersApp>>;

const tables = [
  'users',
  'user_roles',
  'specialties',
  'units',
  'unit_hours',
  'exam_types',
  'unit_exam_offers',
  'doctor_profiles',
  'doctor_time_off',
  'bookings',
  'booking_events',
  'exam_results',
];

async function counts(db: Context['db']) {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const rows = await db.execute<{ total: number }>(sql.raw(`select count(*)::int as total from ${table}`));
    result[table] = rows.rows[0]?.total ?? 0;
  }
  return result;
}

async function bookingsOf(db: Context['db'], email: string) {
  const rows = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from bookings join users on users.id = bookings.patient_id where users.email = ${email}`,
  );
  return rows.rows[0]?.total ?? 0;
}

async function activeFutureOf(context: Context, email: string) {
  const rows = await context.db.execute<{ total: number }>(sql`
    select count(*)::int as total from bookings b join users u on u.id = b.patient_id
    where u.email = ${email} and b.status in ('pending', 'confirmed')
      and b.starts_at > ${context.clock.now().toISOString()}::timestamptz
  `);
  return rows.rows[0]?.total ?? 0;
}

const loginAs = (context: Context, account: { email: string; password: string }) =>
  login(context.app, { email: account.email, password: account.password });

describe('seed', () => {
  it('creates the example doctor as an ordinary account with a profile, a schedule and a blocked date', async () => {
    const context = await buildUsersApp();

    await expect(context.modules.seed.service.seed()).resolves.toEqual([]);

    const response = await loginAs(context, EXAMPLE_DOCTOR).expect(200);
    expect(response.body).toMatchObject({ user: { fullName: 'Dr. João Silveira', roles: ['doctor', 'patient'] } });
    const profile = await context.db.execute<{ council: string; registry_number: string; ranges: number; off: number }>(
      sql`
        select council, registry_number,
          (select count(*)::int from doctor_schedule_ranges r where r.doctor_id = user_id) as ranges,
          (select count(*)::int from doctor_time_off t where t.doctor_id = user_id) as off
        from doctor_profiles join users on users.id = user_id where email = ${EXAMPLE_DOCTOR.email}
      `,
    );
    expect(profile.rows).toEqual([
      {
        council: 'CRM',
        registry_number: EXAMPLE_DOCTOR_PROFILE.registryNumber,
        ranges: expect.any(Number) as unknown,
        off: 1,
      },
    ]);
    expect(profile.rows[0]?.ranges).toBeGreaterThan(0);
  });

  it('creates the example patient with sample bookings inside the normal active limit', async () => {
    const context = await buildUsersApp();

    await context.modules.seed.service.seed();

    await loginAs(context, EXAMPLE_PATIENT).expect(200);
    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toBeGreaterThan(0);
    const active = await activeFutureOf(context, EXAMPLE_PATIENT.email);
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThanOrEqual(ACTIVE_LIMIT);
  });

  it('seeds everything once and adds nothing on a second run', async () => {
    const context = await buildUsersApp();

    await context.modules.seed.service.seed();
    const first = await counts(context.db);
    context.clock.advance(24 * 3_600_000);
    await context.modules.seed.service.seed();

    expect(await counts(context.db)).toEqual(first);
    expect(first).toMatchObject({
      specialties: 5,
      units: 2,
      unit_hours: 11,
      exam_types: 5,
      unit_exam_offers: 8,
      doctor_profiles: 5,
      doctor_time_off: 1,
    });
  });

  it('never restores or resets the example accounts once they exist', async () => {
    const context = await buildUsersApp();
    await context.modules.seed.service.seed();
    const token = ((await loginAs(context, EXAMPLE_PATIENT).expect(200)).body as { token: string }).token;
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
    await context.db.execute(sql`
      delete from user_roles where role = 'doctor' and user_id = (select id from users where email = ${EXAMPLE_DOCTOR.email})
    `);
    const before = await counts(context.db);

    await context.modules.seed.service.seed();

    expect(await counts(context.db)).toEqual(before);
    await loginAs(context, EXAMPLE_PATIENT).expect(401);
    const renamed = await login(context.app, { email: EXAMPLE_PATIENT.email, password: 'nova-senha-456' }).expect(200);
    expect(renamed.body).toMatchObject({ user: { fullName: 'Outro Nome' } });
    await loginAs(context, EXAMPLE_DOCTOR).expect(403);
  });

  it('leaves an account that already holds an example e-mail untouched and seeds nothing for it', async () => {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount({
      ...EXAMPLE_PATIENT,
      fullName: 'Pessoa Real',
      password: 'senha-real-123',
    });

    await context.modules.seed.service.seed();

    const response = await login(context.app, { email: EXAMPLE_PATIENT.email, password: 'senha-real-123' });
    expect(response.body).toMatchObject({ user: { fullName: 'Pessoa Real', roles: ['patient'] } });
    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toBe(0);
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
      sql`select appointment_duration_min from specialties where name = 'clínica geral'`,
    );
    expect(rows.rows).toEqual([{ appointment_duration_min: 45 }]);
    expect(await counts(context.db)).toMatchObject({ specialties: 5 });
  });

  it('adds no opening hours to a unit the admin already created', async () => {
    const context = await buildUsersApp();
    await context.db.execute(
      sql`insert into units (name, address, phone) values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000')`,
    );

    await context.modules.seed.service.seed();

    const rows = await context.db.execute<{ total: number }>(sql`
      select count(*)::int as total from unit_hours join units on units.id = unit_id where units.name = 'Unidade Central'
    `);
    expect(rows.rows[0]?.total).toBe(0);
  });

  it('skips the example doctor profile with a warning when its unit was deactivated', async () => {
    const context = await buildUsersApp();
    await context.db.execute(sql`
      insert into units (name, address, phone, is_active)
      values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000', false)
    `);

    const warnings = await context.modules.seed.service.seed();

    expect(warnings).toContainEqual(expect.stringContaining(`${EXAMPLE_DOCTOR.email} skipped`));
    const response = await loginAs(context, EXAMPLE_DOCTOR).expect(200);
    expect(response.body).toMatchObject({ user: { roles: ['patient'] } });
    expect(await bookingsOf(context.db, EXAMPLE_PATIENT.email)).toBe(0);
  });

  it('grants neither the role nor the profile when the reserved registry is already taken', async () => {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount({
      fullName: 'Outra Médica',
      email: 'outra@saudemais.test',
      password: 'senha-propria-123',
      roles: ['patient'],
    });
    await context.db.execute(sql`
      insert into specialties (name, council, appointment_duration_min) values ('Clínica Geral', 'CRM', 30)
    `);
    await context.db.execute(sql`
      insert into units (name, address, phone) values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000')
    `);
    await context.db.execute(sql`
      insert into doctor_profiles (user_id, specialty_id, council, unit_id, registry_number, registry_uf)
      select u.id, s.id, 'CRM', n.id, ${EXAMPLE_DOCTOR_PROFILE.registryNumber}, 'SP'
      from users u, specialties s, units n where u.email = 'outra@saudemais.test'
    `);

    const warnings = await context.modules.seed.service.seed();

    expect(warnings).toEqual([expect.stringContaining('already in use')]);
    const response = await loginAs(context, EXAMPLE_DOCTOR).expect(200);
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

describe('seedTarget', () => {
  const url = 'postgres://user:secret@db.internal:5432/saudemais';

  it('refuses production unless SEED_ALLOW_PRODUCTION is 1', () => {
    expect(() => seedTarget('production', url, undefined)).toThrow(/SEED_ALLOW_PRODUCTION/);
    expect(seedTarget('production', url, '1')).toBe('db.internal');
  });

  it('returns only the host of the target database', () => {
    expect(seedTarget('development', url, undefined)).toBe('db.internal');
  });
});
