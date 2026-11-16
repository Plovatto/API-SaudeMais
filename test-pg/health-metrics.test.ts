import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
import { START } from '../test/support/users.js';
import { createCleanPool } from './support/pg-test-pool.js';

describe('health_metrics on PostgreSQL', () => {
  let pool: pg.Pool;
  let appointmentId: string;
  let examId: string;

  beforeAll(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const context = buildTestApp({}, { db: createDb(pool), clock: fixedClock(START) });
    await context.modules.users.bootstrap(undefined);
    await context.modules.demo.service.seed();
    await context.modules.maintenance.run({ restoreDemo: true });
    const completed = await pool.query<{ id: string; kind: string }>(
      "select distinct on (kind) id, kind from bookings where status = 'completed' order by kind, starts_at",
    );
    const idOf = (kind: string) => completed.rows.find((row) => row.kind === kind)?.id ?? '';
    appointmentId = idOf('appointment');
    examId = idOf('exam');
    await pool.query('delete from health_metrics');
  });

  afterAll(async () => {
    await pool.end();
  });

  const insert = (values: { systolic?: number; diastolic?: number; weightKg?: string }, bookingId = appointmentId) =>
    pool.query(
      'insert into health_metrics (booking_id, systolic, diastolic, weight_kg, recorded_at) values ($1, $2, $3, $4, now())',
      [bookingId, values.systolic ?? null, values.diastolic ?? null, values.weightKg ?? null],
    );

  it.each([
    [{ systolic: 120 }, 'health_metrics_pressure_pair_check'],
    [{ diastolic: 80, weightKg: '70' }, 'health_metrics_pressure_pair_check'],
    [{ systolic: 301, diastolic: 80 }, 'health_metrics_systolic_check'],
    [{ systolic: 120, diastolic: 29 }, 'health_metrics_diastolic_check'],
    [{ systolic: 80, diastolic: 80 }, 'health_metrics_pressure_order_check'],
    [{ weightKg: '0.99' }, 'health_metrics_weight_kg_check'],
    [{ weightKg: '500.01' }, 'health_metrics_weight_kg_check'],
    [{}, 'health_metrics_present_check'],
  ])('rejects %j with %s', async (values, constraint) => {
    await expect(insert(values)).rejects.toMatchObject({ code: '23514', constraint });
  });

  it('accepts metrics only for appointments', async () => {
    await expect(insert({ weightKg: '70' }, examId)).rejects.toMatchObject({
      code: '23503',
      constraint: 'health_metrics_booking_kind_fkey',
    });
    await expect(
      pool.query(
        "insert into health_metrics (booking_id, booking_kind, weight_kg, recorded_at) values ($1, 'exam', 70, now())",
        [examId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'health_metrics_booking_kind_check' });
  });

  it('stores one row per appointment, returns weight as text and keeps the booking from being deleted', async () => {
    await insert({ systolic: 120, diastolic: 80, weightKg: '72.4' });

    const stored = await pool.query<{ weight_kg: string }>(
      'select weight_kg from health_metrics where booking_id = $1',
      [appointmentId],
    );
    expect(stored.rows).toEqual([{ weight_kg: '72.40' }]);
    await expect(insert({ weightKg: '70' })).rejects.toMatchObject({
      code: '23505',
      constraint: 'health_metrics_pkey',
    });
    await expect(pool.query('delete from bookings where id = $1', [appointmentId])).rejects.toMatchObject({
      code: '23503',
      constraint: 'health_metrics_booking_kind_fkey',
    });
  });
});
