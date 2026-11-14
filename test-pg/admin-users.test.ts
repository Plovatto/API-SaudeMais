import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { registration } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const OTHER = { email: 'outra.admin@email.com', password: 'outra-senha-123' };

describe('admins on PostgreSQL', () => {
  let pool: pg.Pool;
  let context: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    context = buildTestApp({}, { db: createDb(pool) });
    await context.modules.users.bootstrap(ADMIN);
  });

  afterEach(async () => {
    await pool.end();
  });

  const session = async (credentials: typeof ADMIN) => {
    const body = (await request(context.app).post('/api/users/login').send(credentials).expect(200)).body as {
      token: string;
      user: { id: string };
    };
    return body;
  };

  const makeAdmin = async (token: string, email: string, password: string) => {
    const created = await request(context.app)
      .post('/api/users/register')
      .send(registration({ email, password, passwordConfirmation: password }))
      .expect(201);
    const id = (created.body as { id: string }).id;
    await request(context.app)
      .post(`/api/admin/users/${id}/roles/admin`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return id;
  };

  const activeAdmins = async () =>
    (
      await pool.query<{ total: number }>(
        "select count(*)::int as total from user_roles r join users u on u.id = r.user_id where r.role = 'admin' and u.deactivated_at is null",
      )
    ).rows[0]?.total;

  it('never lets one admin deactivate another while being demoted by them', async () => {
    const first = await session(ADMIN);
    const secondEmail = 'terceira.admin@email.com';
    const secondId = await makeAdmin(first.token, secondEmail, 'terceira-senha-123');
    const second = await session({ email: secondEmail, password: 'terceira-senha-123' });

    const results = await Promise.all([
      request(context.app)
        .post(`/api/admin/users/${secondId}/deactivate`)
        .set('Authorization', `Bearer ${first.token}`),
      request(context.app)
        .delete(`/api/admin/users/${first.user.id}/roles/admin`)
        .set('Authorization', `Bearer ${second.token}`),
    ]);

    const [winner, loser] = results.map((response) => response.status).sort();
    expect(winner).toBe(200);
    expect([401, 403, 409]).toContain(loser);
    expect(await activeAdmins()).toBe(1);
  });

  it('never lets two admins remove each other at the same time', async () => {
    const first = await session(ADMIN);
    const created = await request(context.app)
      .post('/api/users/register')
      .send(registration({ email: OTHER.email, password: OTHER.password, passwordConfirmation: OTHER.password }))
      .expect(201);
    const otherId = (created.body as { id: string }).id;
    await request(context.app)
      .post(`/api/admin/users/${otherId}/roles/admin`)
      .set('Authorization', `Bearer ${first.token}`)
      .expect(200);
    const second = await session(OTHER);

    const results = await Promise.all([
      request(context.app)
        .delete(`/api/admin/users/${otherId}/roles/admin`)
        .set('Authorization', `Bearer ${first.token}`),
      request(context.app)
        .delete(`/api/admin/users/${first.user.id}/roles/admin`)
        .set('Authorization', `Bearer ${second.token}`),
    ]);

    const [winner, loser] = results.map((response) => response.status).sort();
    expect(winner).toBe(200);
    expect([403, 409]).toContain(loser);
    expect(await activeAdmins()).toBe(1);
  });
});
