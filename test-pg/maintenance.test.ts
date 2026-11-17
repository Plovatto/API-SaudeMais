import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { DEMO_BOOKINGS } from '@/modules/demo/demo.data.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { registerSchema } from '@/modules/users/user.model.js';
import { registration, START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

const MAINTENANCE_LOCK = 727_004;
const OPTIONS = { restoreDemo: false };

const runJob = (...args: string[]) =>
  promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/jobs/run.ts', ...args], { env: process.env });

describe('maintenance on PostgreSQL', () => {
  let pool: pg.Pool;
  let context: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    await pool.query(`
      insert into bookings (kind, patient_id, unit_id, doctor_id, specialty_id, visit_type, starts_at, ends_at, status)
      select 'appointment', patient.id, p.unit_id, p.user_id, p.specialty_id, 'routine',
        timestamptz '2026-01-05T10:00:00Z', timestamptz '2026-01-05T10:30:00Z', 'pending'
      from users patient, doctor_profiles p join users d on d.id = p.user_id
      where patient.email = 'andreia.soares@saudemais.test' and d.full_name = 'Dr. Carlos Mendes'
    `);
  });

  afterEach(async () => {
    await pool.end();
  });

  const expiredNotices = async () =>
    (
      await pool.query<{ total: number }>(
        "select count(*)::int as total from notifications where type = 'appointment_expired'",
      )
    ).rows[0]?.total;

  it('skips the run while another runner holds the lock', async () => {
    const other = await pool.connect();
    await other.query('begin');
    await other.query('select pg_advisory_xact_lock($1, 0)', [MAINTENANCE_LOCK]);

    await expect(context.modules.maintenance.runExclusive(OPTIONS)).resolves.toBeUndefined();
    expect(await expiredNotices()).toBe(0);

    await other.query('commit');
    other.release();
    await expect(context.modules.maintenance.runExclusive(OPTIONS)).resolves.toMatchObject({ expired: 1 });
    expect(await expiredNotices()).toBe(1);
  });

  it('lets only one of two simultaneous runners do the work', async () => {
    const reports = await Promise.all([
      context.modules.maintenance.runExclusive(OPTIONS),
      context.modules.maintenance.runExclusive(OPTIONS),
    ]);

    expect(reports.reduce((total, report) => total + (report?.expired ?? 0), 0)).toBe(1);
    expect(await expiredNotices()).toBe(1);
  });

  it('restores the demo bookings only once when two restorations race', async () => {
    const results = await Promise.all([context.modules.demo.service.restore(), context.modules.demo.service.restore()]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const demo = await pool.query<{ total: number }>(
      'select count(*)::int as total from bookings b join users u on u.id = b.patient_id where u.is_protected',
    );
    expect(demo.rows[0]?.total).toBe(DEMO_BOOKINGS.length);
  });

  it('sends one reminder when two runners claim the same booking', async () => {
    await context.modules.users.service.register(
      registerSchema.parse(registration({ email: 'lembrete@email.com' })),
    );
    await pool.query(`
      insert into bookings (kind, patient_id, unit_id, doctor_id, specialty_id, visit_type, starts_at, ends_at, status)
      select 'appointment', patient.id, p.unit_id, p.user_id, p.specialty_id, 'routine',
        timestamptz '2026-11-20T15:00:00Z', timestamptz '2026-11-20T15:30:00Z', 'confirmed'
      from users patient, doctor_profiles p join users d on d.id = p.user_id
      where patient.email = 'lembrete@email.com' and d.full_name = 'Dr. Carlos Mendes'
    `);

    const sent = await Promise.all([
      context.modules.email.notifier.remindUpcoming(),
      context.modules.email.notifier.remindUpcoming(),
    ]);
    await context.mail.drain();

    expect(sent[0] + sent[1]).toBe(1);
    expect(context.mailer.sent.filter((message) => message.to === 'lembrete@email.com')).toHaveLength(1);
  });

  it('runs from the command line and exits with 0', async () => {
    await expect(runJob('maintenance')).resolves.toBeDefined();
    expect(await expiredNotices()).toBe(1);
    await expect(runJob('unknown')).rejects.toMatchObject({ code: 1 });
  }, 60_000);
});
