import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildUsersApp, login, registration } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

async function withAdmin() {
  const context = await buildUsersApp();
  await context.modules.users.bootstrap(ADMIN);
  const token = ((await login(context.app, ADMIN).expect(200)).body as { token: string }).token;
  return { ...context, token };
}

describe('GET /api/admin/home', () => {
  it('counts only active, non-demo accounts per role', async () => {
    const context = await withAdmin();
    for (const email of ['ana@email.com', 'bruno@email.com', 'carla@email.com']) {
      await request(context.app).post('/api/users/register').send(registration({ email })).expect(201);
    }
    await context.db.execute(sql`update users set deactivated_at = now() where email = 'carla@email.com'`);
    const [bruno] = (
      await context.db.execute<{ id: string }>(sql`select id from users where email = 'bruno@email.com'`)
    ).rows;
    await context.db.execute(sql`insert into user_roles (user_id, role) values (${bruno?.id}, 'doctor')`);

    const response = await request(context.app).get('/api/admin/home').set('Authorization', `Bearer ${context.token}`);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ patients: 3, doctors: 1, appointmentsToday: 0 });
  });

  it('leaves protected demo accounts out of the counts', async () => {
    const context = await withAdmin();
    await context.db.execute(
      sql`insert into user_roles (user_id, role) select id, 'doctor' from users where email = 'paciente@saudemais.test'`,
    );

    const response = await request(context.app).get('/api/admin/home').set('Authorization', `Bearer ${context.token}`);

    expect(response.body).toEqual({ patients: 1, doctors: 0, appointmentsToday: 0 });
  });

  it('counts the appointments of the São Paulo day, without the cancelled, the expired and the demo ones', async () => {
    const context = await withAdmin();
    await context.modules.demo.service.seed();
    await request(context.app)
      .post('/api/users/register')
      .send(registration({ email: 'ana@email.com' }))
      .expect(201);
    const insert = (email: string, startsAt: string, status = 'confirmed') =>
      context.db.execute(sql`
        insert into bookings (kind, patient_id, unit_id, doctor_id, specialty_id, visit_type, starts_at, ends_at, status, cancelled_at, cancelled_by_role)
        select 'appointment', u.id, p.unit_id, p.user_id, p.specialty_id, 'routine', ${startsAt}::timestamptz,
          ${startsAt}::timestamptz + interval '30 minutes', ${status}::text,
          case when ${status}::text = 'cancelled' then now() end, case when ${status}::text = 'cancelled' then 'system' end
        from users u, doctor_profiles p join users d on d.id = p.user_id
        where u.email = ${email} and d.full_name = 'Dr. Carlos Mendes'
      `);
    await insert('ana@email.com', '2026-11-20T02:30:00Z', 'completed');
    await insert('ana@email.com', '2026-11-20T03:00:00Z', 'completed');
    await insert('ana@email.com', '2026-11-20T10:00:00Z', 'pending');
    await insert('ana@email.com', '2026-11-20T11:00:00Z', 'no_show');
    await insert('ana@email.com', '2026-11-20T13:00:00Z', 'pending');
    await insert('ana@email.com', '2026-11-20T14:00:00Z', 'cancelled');
    await insert('ana@email.com', '2026-11-21T02:30:00Z');
    await insert('ana@email.com', '2026-11-21T03:00:00Z');
    await insert('paciente@saudemais.test', '2026-11-20T15:00:00Z');

    const response = await request(context.app).get('/api/admin/home').set('Authorization', `Bearer ${context.token}`);

    expect(response.body).toMatchObject({ appointmentsToday: 4 });
  });

  it('is only for admins', async () => {
    const context = await withAdmin();
    await request(context.app).post('/api/users/register').send(registration()).expect(201);
    const patient = ((await login(context.app).expect(200)).body as { token: string }).token;

    expect((await request(context.app).get('/api/admin/home')).status).toBe(401);
    expect((await request(context.app).get('/api/admin/home').set('Authorization', `Bearer ${patient}`)).status).toBe(
      403,
    );
  });
});
