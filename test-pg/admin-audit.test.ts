import type pg from 'pg';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { as } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

describe('audit log listing on PostgreSQL', () => {
  let pool: pg.Pool;
  let context: ReturnType<typeof buildTestApp>;
  let token: string;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    context = buildTestApp({}, { db: createDb(pool) });
    await context.modules.users.bootstrap(ADMIN);
    token = ((await request(context.app).post('/api/users/login').send(ADMIN).expect(200)).body as { token: string })
      .token;
  });

  afterEach(async () => {
    await pool.end();
  });

  it('creates the indexes that serve the filters', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename = 'audit_logs' order by indexname",
    );

    expect(rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining(['audit_logs_action_id_idx', 'audit_logs_actor_id_id_idx', 'audit_logs_entity_idx']),
    );
  });

  it('pages newest first by uuid v7 without skipping entries written in the same transaction', async () => {
    await pool.query(
      "insert into audit_logs (actor_type, action, entity_type, entity_id) select 'system', 'policy.updated', 'settings', 'policy' from generate_series(1, 25)",
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(context.app)
        .get('/api/admin/audit-logs')
        .query({ entityType: 'settings', limit: 10, ...(cursor && { cursor }) })
        .set(as(token))
        .expect(200);
      const page = response.body as { items: { id: string }[]; nextCursor: string | null };
      seen.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(seen).toEqual([...seen].sort().reverse());
  });
});
