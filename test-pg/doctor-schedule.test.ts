import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { WEEKDAYS } from '@/lib/week.js';
import { DoctorScheduleRepository } from '@/modules/doctor-schedule/doctor-schedule.repository.js';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { createCleanPool } from './support/pg-test-pool.js';

const week = (weekday: number, ranges: { startMin: number; endMin: number }[]) =>
  WEEKDAYS.map((day) => ({
    weekday: day,
    isActive: day === weekday,
    ranges: day === weekday ? ranges : [],
  }));

describe('doctor schedule on PostgreSQL', () => {
  let pool: pg.Pool;
  let doctorId: string;

  beforeEach(async () => {
    pool = await createCleanPool();
    await runMigrations(pool);
    const context = buildTestApp({}, { db: createDb(pool) });
    await context.modules.demo.service.ensure();
    const row = await pool.query<{ id: string }>('select id from users where email = $1', [DEMO_DOCTOR.email]);
    doctorId = row.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await pool.end();
  });

  const insertRange = (weekday: number, startMin: number, endMin: number) =>
    pool.query('insert into doctor_schedule_ranges (doctor_id, weekday, start_min, end_min) values ($1, $2, $3, $4)', [
      doctorId,
      weekday,
      startMin,
      endMin,
    ]);

  it('rejects overlapping ranges of the same day with the exclusion constraint', async () => {
    await expect(insertRange(1, 600, 780)).rejects.toMatchObject({
      code: '23P01',
      constraint: 'doctor_schedule_ranges_no_overlap_excl',
    });
    await expect(insertRange(1, 720, 780)).resolves.toBeDefined();
  });

  it('serializes concurrent saves so the week is never mixed', async () => {
    const repository = new DoctorScheduleRepository(createDb(pool));
    const actor = { actorId: doctorId, ip: null };
    const schedules = [
      week(1, [{ startMin: 480, endMin: 720 }]),
      week(2, [{ startMin: 600, endMin: 660 }]),
      week(3, [{ startMin: 780, endMin: 900 }]),
    ];

    await Promise.all(schedules.map((days) => repository.replace({ doctorId, days, actor, check: () => undefined })));

    const days = await pool.query<{ total: number }>(
      'select count(*)::int as total from doctor_schedule_days where doctor_id = $1',
      [doctorId],
    );
    const ranges = await pool.query<{ weekday: number }>(
      'select weekday from doctor_schedule_ranges where doctor_id = $1',
      [doctorId],
    );
    expect(days.rows[0]?.total).toBe(7);
    expect(ranges.rows).toHaveLength(1);
  });
});
