import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import { buildUsersApp, login } from './support/users.js';

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

    await expect(context.modules.demo.service.seed()).resolves.toBeUndefined();
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
});
