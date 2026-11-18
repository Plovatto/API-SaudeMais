import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEMO_DOCTOR_PROFILE } from '@/modules/demo/demo.data.js';
import { seedTarget } from '@/modules/demo/seed-guard.js';
import { DEMO_DOCTOR, DEMO_PATIENT } from '@/modules/users/user.demo.js';
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

describe('demo data', () => {
  it('creates the protected demo doctor with a doctor profile at startup', async () => {
    const context = await buildUsersApp();

    await context.modules.demo.service.ensure();

    const response = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { fullName: 'Dr. João Silveira', roles: ['doctor', 'patient'] } });
    const profile = await context.db.execute<{ council: string; registry_uf: string; is_protected: boolean }>(sql`
      select council, registry_uf, is_protected from doctor_profiles join users on users.id = user_id
      where email = ${DEMO_DOCTOR.email}
    `);
    expect(profile.rows).toEqual([{ council: 'CRM', registry_uf: 'SP', is_protected: true }]);
  });

  it('seeds catalogs, doctors and patients without duplicating anything on a second run', async () => {
    const context = await buildUsersApp();

    await context.modules.demo.service.seed();
    const first = await counts(context.db);
    await context.modules.demo.service.seed();

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
    await context.modules.demo.service.seed();
    await context.db.execute(sql`
      delete from user_roles where role = 'doctor'
        and user_id = (select id from users where email = 'ana.ferreira@saudemais.test')
    `);

    await expect(context.modules.demo.service.seed()).resolves.toEqual([]);
  });

  it('keeps a catalog item the admin already created under the same name', async () => {
    const context = await buildUsersApp();
    await context.db.execute(
      sql`insert into specialties (name, council, appointment_duration_min) values ('clínica geral', 'CRM', 45)`,
    );

    await context.modules.demo.service.ensure();

    const rows = await context.db.execute<{ appointment_duration_min: number }>(
      sql`select appointment_duration_min from specialties`,
    );
    expect(rows.rows).toEqual([{ appointment_duration_min: 45 }]);
  });

  it('adds no opening hours to a unit the admin already created', async () => {
    const context = await buildUsersApp();
    await context.db.execute(
      sql`insert into units (name, address, phone) values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000')`,
    );

    await expect(context.modules.demo.service.ensure()).resolves.toEqual([]);

    expect(await counts(context.db)).toMatchObject({ units: 1, unit_hours: 0, doctor_profiles: 1 });
  });

  it('never recreates catalog items the admin renamed after the first start', async () => {
    const context = await buildUsersApp();
    await context.modules.demo.service.ensure();
    await context.db.execute(sql`update specialties set name = 'Clínica Médica'`);
    await context.db.execute(sql`update units set name = 'Unidade Centro'`);
    const before = await counts(context.db);

    await expect(context.modules.demo.service.ensure()).resolves.toEqual([]);

    expect(await counts(context.db)).toEqual(before);
  });

  it('skips the demo doctor profile with a warning when its unit was deactivated', async () => {
    const context = await buildUsersApp();
    await context.db.execute(sql`
      insert into units (name, address, phone, is_active)
      values ('Unidade Central', 'Rua das Flores, 10', '+5511999990000', false)
    `);

    const warnings = await context.modules.demo.service.ensure();

    expect(warnings).toEqual([expect.stringContaining('missing or inactive')]);
    expect(await counts(context.db)).toMatchObject({ doctor_profiles: 0, unit_hours: 0 });
    const response = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    expect(response.body).toMatchObject({ user: { roles: ['patient'] } });
  });

  it('grants neither the role nor the profile when the reserved registry is already taken', async () => {
    const context = await buildUsersApp();
    await context.modules.demo.service.seed();
    await context.db.execute(sql`
      delete from user_roles where role = 'doctor' and user_id = (select id from users where email = ${DEMO_DOCTOR.email})
    `);
    await context.db.execute(
      sql`delete from doctor_profiles where registry_number = ${DEMO_DOCTOR_PROFILE.registryNumber}`,
    );
    await context.db.execute(sql`
      update doctor_profiles set registry_number = ${DEMO_DOCTOR_PROFILE.registryNumber}, registry_uf = 'SP'
      where user_id = (select id from users where email = 'carlos.mendes@saudemais.test')
    `);

    const warnings = await context.modules.demo.service.ensure();

    expect(warnings).toEqual([expect.stringContaining('already in use')]);
    const response = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    expect(response.body).toMatchObject({ user: { roles: ['patient'] } });
  });

  it('gives sample doctor profiles only to accounts it created', async () => {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount({
      fullName: 'Ana Ferreira',
      email: 'ana.ferreira@saudemais.test',
      password: 'senha-propria-123',
      roles: ['patient'],
      isProtected: false,
    });

    await context.modules.demo.service.seed();

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

    await context.modules.demo.service.seed();

    const rows = await context.db.execute<{ code: string }>(
      sql`select code from exam_types where code like 'hemograma%' order by code`,
    );
    expect(rows.rows).toEqual([{ code: 'hemograma_completo' }]);
  });
});

async function bookingsOf(db: Awaited<ReturnType<typeof buildUsersApp>>['db'], email: string) {
  const rows = await db.execute<{ total: number }>(
    sql`select count(*)::int as total from bookings join users on users.id = bookings.patient_id where users.email = ${email}`,
  );
  return rows.rows[0]?.total ?? 0;
}

describe('demo account restore', () => {
  async function restored() {
    const context = await buildUsersApp();
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    return context;
  }

  it('makes the documented credentials work again after a password change', async () => {
    const context = await restored();
    const first = await login(context.app, { email: DEMO_PATIENT.email, password: DEMO_PATIENT.password });
    await request(context.app)
      .post('/api/me/password')
      .set(as((first.body as { token: string }).token))
      .send({
        currentPassword: DEMO_PATIENT.password,
        password: 'nova-senha-456',
        passwordConfirmation: 'nova-senha-456',
      })
      .expect(204);
    expect((await login(context.app, { email: DEMO_PATIENT.email, password: DEMO_PATIENT.password })).status).toBe(401);

    await context.modules.demo.service.restore();

    expect((await login(context.app, { email: DEMO_PATIENT.email, password: DEMO_PATIENT.password })).status).toBe(200);
  });

  it('reactivates a deactivated demo account and restores its name', async () => {
    const context = await restored();
    await context.db.execute(
      sql`update users set deactivated_at = now(), full_name = 'Outro Nome' where email = ${DEMO_DOCTOR.email}`,
    );

    await context.modules.demo.service.restore();

    const response = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { fullName: DEMO_DOCTOR.fullName } });
  });

  it('grants the doctor role again when it was revoked but the profile remains', async () => {
    const context = await restored();
    await context.db.execute(
      sql`delete from user_roles where role = 'doctor' and user_id = (select id from users where email = ${DEMO_DOCTOR.email})`,
    );

    await context.modules.demo.service.restore();

    const response = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    expect(response.body).toMatchObject({ user: { roles: ['doctor', 'patient'] } });
  });

  it('reactivates a deactivated demo patient and seeds its bookings', async () => {
    const context = await restored();
    await context.db.execute(sql`update users set deactivated_at = now() where email = ${DEMO_PATIENT.email}`);

    await context.modules.demo.service.restore();

    expect((await login(context.app, { email: DEMO_PATIENT.email, password: DEMO_PATIENT.password })).status).toBe(200);
    expect(await bookingsOf(context.db, DEMO_PATIENT.email)).toBeGreaterThan(0);
  });

  it('leaves a regular account that holds a demo e-mail untouched and seeds nothing for it', async () => {
    const context = await buildUsersApp();
    await context.modules.users.service.ensureAccount({
      ...DEMO_PATIENT,
      fullName: 'Pessoa Real',
      password: 'senha-real-123',
      isProtected: false,
    });
    await context.modules.demo.service.seed();

    await context.modules.demo.service.restore();

    const response = await login(context.app, { email: DEMO_PATIENT.email, password: 'senha-real-123' });
    expect(response.body).toMatchObject({ user: { fullName: 'Pessoa Real', roles: ['patient'] } });
    expect(await bookingsOf(context.db, DEMO_PATIENT.email)).toBe(0);
  });

  it('restores the accounts once a day, so changes survive the other maintenance runs', async () => {
    const context = await restored();
    await context.modules.demo.service.restore();
    await context.db.execute(sql`update users set full_name = 'Outro Nome' where email = ${DEMO_PATIENT.email}`);

    await context.modules.demo.service.restore();

    const name = await context.db.execute<{ full_name: string }>(
      sql`select full_name from users where email = ${DEMO_PATIENT.email}`,
    );
    expect(name.rows[0]?.full_name).toBe('Outro Nome');
  });

  it('keeps exactly one future blocked date for the demo doctor, replacing the ones it added', async () => {
    const context = await restored();
    const blockedDates = async () =>
      (
        await context.db.execute<{ date: string; reason: string | null }>(sql`
          select t.date::text as date, t.reason from doctor_time_off t join users u on u.id = t.doctor_id
          where u.email = ${DEMO_DOCTOR.email}
        `)
      ).rows;
    await context.modules.demo.service.restore();
    await context.db.execute(sql`
      insert into doctor_time_off (doctor_id, date) select id, '2026-12-31' from users where email = ${DEMO_DOCTOR.email}
    `);
    context.clock.advance(24 * HOUR);

    await context.modules.demo.service.restore();

    const dates = await blockedDates();
    expect(dates).toHaveLength(1);
    expect(dates[0]?.reason).toBe('Congresso médico');
    expect(dates[0]?.date > '2026-11-21').toBe(true);
    expect([0, 6]).not.toContain(new Date(`${dates[0]?.date ?? ''}T12:00:00Z`).getUTCDay());
  });

  it('ends the sessions that existed before the password was reset', async () => {
    const context = await restored();
    const first = await login(context.app, { email: DEMO_PATIENT.email, password: DEMO_PATIENT.password });
    const { token } = first.body as { token: string };
    await context.db.execute(sql`
      update users set password_hash = (select password_hash from users where email = ${DEMO_DOCTOR.email})
      where email = ${DEMO_PATIENT.email}
    `);
    expect(await context.auth.authenticate(token)).not.toBeNull();

    await context.modules.demo.service.restore();

    expect(await context.auth.authenticate(token)).toBeNull();
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
