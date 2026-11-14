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
    await context.db.execute(sql`update users set is_protected = true where email = ${ADMIN.email}`);
    await context.db.execute(
      sql`insert into user_roles (user_id, role) select id, 'doctor' from users where email = 'paciente@saudemais.test'`,
    );
    await context.db.execute(sql`update users set is_protected = false where email = ${ADMIN.email}`);

    const response = await request(context.app).get('/api/admin/home').set('Authorization', `Bearer ${context.token}`);

    expect(response.body).toEqual({ patients: 1, doctors: 0, appointmentsToday: 0 });
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
