import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { PasswordResetRepository } from '@/modules/password-reset/password-reset.repository.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { registration } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const MINUTE = 60_000;

describe('password reset links on PostgreSQL', () => {
  let pool: pg.Pool;
  let resets: PasswordResetRepository;
  const ids: string[] = [];
  let hashes = 0;

  beforeAll(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const db = createDb(pool);
    const { app } = buildTestApp({}, { db });
    for (const email of ['ana@email.com', 'bruno@email.com', 'carla@email.com']) {
      const created = await request(app).post('/api/users/register').send(registration({ email })).expect(201);
      ids.push((created.body as { id: string }).id);
    }
    resets = new PasswordResetRepository(db, { perUserPerHour: 5, minIntervalMs: 30_000 });
  });

  afterAll(async () => {
    await pool.end();
  });

  const issue = (userId: string | undefined) => {
    const now = new Date();
    hashes += 1;
    return resets.issue({
      userId: userId ?? '',
      requestedBy: null,
      tokenHash: hashes.toString(16).padStart(64, '0'),
      now,
      expiresAt: new Date(now.getTime() + 30 * MINUTE),
    });
  };

  it('issues only one of two simultaneous links for the same account', async () => {
    const results = await Promise.all([issue(ids[0]), issue(ids[0])]);

    expect(results.sort()).toEqual([false, true]);
    const open = await pool.query<{ total: number }>(
      'select count(*)::int as total from password_reset_tokens where user_id = $1 and revoked_at is null',
      [ids[0]],
    );
    expect(open.rows[0]?.total).toBe(1);
  });

  it('issues simultaneous links for different accounts', async () => {
    const results = await Promise.all([issue(ids[1]), issue(ids[2])]);

    expect(results).toEqual([true, true]);
  });
});
