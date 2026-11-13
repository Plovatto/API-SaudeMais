import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { registration } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

describe('users on PostgreSQL', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildTestApp>['app'];

  beforeAll(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    app = buildTestApp({}, { db: createDb(pool) }).app;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts only one of two simultaneous sign-ups with the same e-mail', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/api/users/register').send(registration({ email: 'carla@email.com' })),
      request(app).post('/api/users/register').send(registration({ email: 'CARLA@email.com' })),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const users = await pool.query<{ total: number }>("select count(*)::int as total from users where email = 'carla@email.com'");
    expect(users.rows[0]?.total).toBe(1);
  });

  it('generates time-ordered ids and keeps updated_at current', async () => {
    const created = await request(app).post('/api/users/register').send(registration({ email: 'davi@email.com' }));
    const id = (created.body as { id: string }).id;

    await pool.query("update users set full_name = 'Davi Souza' where id = $1", [id]);
    const row = await pool.query<{ version: string; touched: boolean }>(
      'select substr(id::text, 15, 1) as version, updated_at > created_at as touched from users where id = $1',
      [id],
    );

    expect(row.rows[0]).toEqual({ version: '7', touched: true });
  });
});
