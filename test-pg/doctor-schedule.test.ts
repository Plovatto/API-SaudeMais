import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '@/database/migrate.js';
import { createDb } from '@/database/pg-client.js';
import { WEEKDAYS } from '@/lib/week.js';
import { DoctorScheduleRepository } from '@/modules/doctor-schedule/doctor-schedule.repository.js';
import { DoctorScheduleService } from '@/modules/doctor-schedule/doctor-schedule.service.js';
import { EXAMPLE_DOCTOR } from '@/modules/seed/seed.data.js';
import { buildTestApp } from '../test/support/build-test-app.js';
import { fixedClock } from '../test/support/fixed-clock.js';
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
    await context.modules.seed.service.seed();
    const row = await pool.query<{ id: string }>('select id from users where email = $1', [EXAMPLE_DOCTOR.email]);
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

  it('blocks a day once when two requests race, answering TIME_OFF_EXISTS to the other', async () => {
    const service = new DoctorScheduleService(
      new DoctorScheduleRepository(createDb(pool)),
      fixedClock(new Date('2026-11-20T12:00:00.000Z')),
    );
    const actor = { actorId: doctorId, ip: null };

    const results = await Promise.allSettled(
      ['Congresso', 'Viagem'].map((reason) => service.block(doctorId, { date: '2026-12-24', reason }, actor)),
    );

    const rows = await pool.query('select reason from doctor_time_off where doctor_id = $1 and date = $2', [
      doctorId,
      '2026-12-24',
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409, code: 'TIME_OFF_EXISTS' },
    });
    expect(rows.rows).toHaveLength(1);
  });
});
