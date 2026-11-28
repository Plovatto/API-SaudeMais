import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLE_PATIENT } from '@/modules/seed/seed.data.js';
import { binary } from './support/binary.js';
import { setupClinic, type Clinic } from './support/doctors.js';
import { insertAppointment, insertExam, REPORT_PATIENT } from './support/report-bookings.js';
import { as, login } from './support/users.js';
import { workbookOf } from './support/xlsx.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const PERIOD = { from: '2026-11-09', to: '2026-11-20' };

let context: Clinic;
let admin: string;

interface Insights {
  period: { from: string; to: string; granularity: 'day' | 'week' };
  heatmap: { weekday: number; hour: number; total: number }[];
  leadTime: {
    sameDay: number;
    upTo3Days: number;
    upTo7Days: number;
    upTo14Days: number;
    upTo30Days: number;
    over30Days: number;
    medianHours: number | null;
  };
  doctors: { id: string; name: string; total: number; completed: number; noShow: number; cancelled: number }[];
  units: {
    id: string;
    name: string;
    total: number;
    appointments: number;
    exams: number;
    completed: number;
    noShow: number;
    cancelled: number;
  }[];
  signups: { total: number; series: { start: string; total: number }[] };
  reschedules: { bookings: number; total: number };
}

const insights = (query: Record<string, string> = PERIOD, token = admin) =>
  request(context.app).get('/api/admin/reports/insights').query(query).set(as(token));

async function insightsOf(query: Record<string, string> = PERIOD) {
  return (await insights(query).expect(200)).body as Insights;
}

const exportOf = (format: 'pdf' | 'xlsx') =>
  request(context.app)
    .get('/api/admin/reports/export')
    .query({ ...PERIOD, format })
    .set(as(admin))
    .buffer(true)
    .parse(binary)
    .expect(200);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

beforeAll(async () => {
  context = await setupClinic();
  await context.modules.users.bootstrap(ADMIN);
  admin = ((await login(context.app, ADMIN).expect(200)).body as { token: string }).token;
  const { db } = context;

  await insertAppointment(db, '2026-11-09T12:00:00Z', 'completed', { createdAt: '2026-11-09T10:00:00Z' });
  await insertAppointment(db, '2026-11-16T12:00:00Z', 'completed', { createdAt: '2026-11-15T12:00:00Z' });
  await insertAppointment(db, '2026-11-10T13:30:00Z', 'no_show', {
    doctor: 'Dra. Ana Ferreira',
    createdAt: '2026-11-07T13:30:00Z',
    reschedules: 2,
  });
  await insertAppointment(db, '2026-11-11T13:00:00Z', 'cancelled', {
    role: 'patient',
    createdAt: '2026-10-01T13:00:00Z',
  });
  await insertAppointment(db, '2026-11-12T13:00:00Z', 'expired', {
    doctor: 'Dra. Ana Ferreira',
    createdAt: '2026-11-05T13:00:00Z',
  });
  await insertAppointment(db, '2026-11-13T02:30:00Z', 'completed', {
    doctor: 'Dra. Beatriz Lima',
    createdAt: '2026-11-01T02:30:00Z',
    reschedules: 1,
  });
  await insertAppointment(db, '2026-11-25T12:00:00Z', 'pending', { createdAt: '2026-11-18T12:00:00Z' });
  await insertAppointment(db, '2026-11-08T12:00:00Z', 'completed', { createdAt: '2026-11-01T12:00:00Z' });
  await insertExam(db, 'hemograma', 'EX-BBBBB1', '2026-11-16T12:00:00Z', 'completed', {
    createdAt: '2026-10-20T12:00:00Z',
  });
  await insertExam(db, 'glicemia', 'EX-BBBBB2', '2026-11-19T12:00:00Z', 'confirmed', {
    createdAt: '2026-10-10T12:00:00Z',
  });

  await db.execute(sql`update users set created_at = '2026-01-01T12:00:00Z'`);
  await db.execute(sql`update users set created_at = '2026-11-10T12:00:00Z' where email = ${REPORT_PATIENT}`);
  await db.execute(sql`update users set created_at = '2026-11-10T15:00:00Z' where email = ${EXAMPLE_PATIENT.email}`);
  await db.execute(sql`update users set created_at = '2026-11-19T12:00:00Z' where email = ${ADMIN.email}`);
}, 60_000);

describe('GET /api/admin/reports/insights', () => {
  it('counts live bookings by weekday and local hour in São Paulo', async () => {
    const response = await insights().expect(200);
    const report = response.body as Insights;

    expect(response.headers['cache-control']).toBe('no-store');
    expect(report.period).toEqual({ ...PERIOD, granularity: 'day' });
    expect(report.heatmap).toEqual([
      { weekday: 1, hour: 9, total: 3 },
      { weekday: 2, hour: 10, total: 1 },
      { weekday: 4, hour: 9, total: 1 },
      { weekday: 4, hour: 23, total: 1 },
    ]);
  });

  it('buckets the lead time of the bookings that start in the period and gives the median', async () => {
    const { leadTime } = await insightsOf();

    expect(leadTime).toEqual({
      sameDay: 1,
      upTo3Days: 1,
      upTo7Days: 1,
      upTo14Days: 2,
      upTo30Days: 1,
      over30Days: 2,
      medianHours: 228,
    });
  });

  it('ranks doctors by appointments with their outcomes, breaking ties by name', async () => {
    const { doctors } = await insightsOf();

    expect(
      doctors.map(({ name, total, completed, noShow, cancelled }) => ({ name, total, completed, noShow, cancelled })),
    ).toEqual([
      { name: 'Dr. Carlos Mendes', total: 3, completed: 2, noShow: 0, cancelled: 1 },
      { name: 'Dra. Ana Ferreira', total: 2, completed: 0, noShow: 1, cancelled: 0 },
      { name: 'Dra. Beatriz Lima', total: 1, completed: 1, noShow: 0, cancelled: 0 },
    ]);
  });

  it('lists every unit with bookings, split by kind and outcome', async () => {
    const { units } = await insightsOf();

    expect(sum(units.map(({ total }) => total))).toBe(8);
    expect(sum(units.map(({ appointments }) => appointments))).toBe(6);
    expect(sum(units.map(({ exams }) => exams))).toBe(2);
    expect(sum(units.map(({ completed }) => completed))).toBe(4);
    expect(sum(units.map(({ noShow }) => noShow))).toBe(1);
    expect(sum(units.map(({ cancelled }) => cancelled))).toBe(1);
    for (const unit of units) expect(unit.appointments + unit.exams).toBe(unit.total);
    const totals = units.map(({ total }) => total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('counts new accounts per day and per week', async () => {
    const daily = (await insightsOf()).signups;
    const weekly = (await insightsOf({ from: '2026-09-01', to: '2026-11-20' })).signups;

    expect(daily.total).toBe(3);
    expect(daily.series).toHaveLength(12);
    expect(daily.series.filter(({ total }) => total > 0)).toEqual([
      { start: '2026-11-10', total: 2 },
      { start: '2026-11-19', total: 1 },
    ]);
    expect(weekly.total).toBe(3);
    expect(weekly.series).toHaveLength(12);
    expect(weekly.series.slice(-2)).toEqual([
      { start: '2026-11-10', total: 2 },
      { start: '2026-11-17', total: 1 },
    ]);
  });

  it('counts rescheduled bookings and their reschedules', async () => {
    expect((await insightsOf()).reschedules).toEqual({ bookings: 2, total: 3 });
  });

  it('answers empty collections and zeros for a period without bookings', async () => {
    const report = await insightsOf({ from: '2026-01-02', to: '2026-01-08' });

    expect(report.heatmap).toEqual([]);
    expect(report.leadTime).toEqual({
      sameDay: 0,
      upTo3Days: 0,
      upTo7Days: 0,
      upTo14Days: 0,
      upTo30Days: 0,
      over30Days: 0,
      medianHours: null,
    });
    expect(report.doctors).toEqual([]);
    expect(report.units).toEqual([]);
    expect(report.signups.total).toBe(0);
    expect(report.signups.series).toHaveLength(7);
    expect(report.reschedules).toEqual({ bookings: 0, total: 0 });
  });

  it('defaults to the last 30 days and refuses the same periods as the report', async () => {
    expect((await insightsOf({})).period).toEqual({ from: '2026-10-22', to: '2026-11-20', granularity: 'day' });
    await insights({ from: '2025-11-20', to: '2026-11-20' }).expect(200);

    const refused = [
      await insights({ from: '2025-11-19', to: '2026-11-20' }),
      await insights({ from: '2026-11-20', to: '2026-11-19' }),
      await insights({ day: '2026-11-20' }),
    ];

    expect(refused.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(refused[0]?.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { to: 'Consulte no máximo 366 dias por vez.' },
    });
  });

  it('keeps no personal data', async () => {
    const response = await insights().expect(200);

    expect(response.text).not.toContain(REPORT_PATIENT);
    expect(response.text).not.toContain('@');
  });

  it('is only for admins', async () => {
    expect((await request(context.app).get('/api/admin/reports/insights')).status).toBe(401);
    expect((await insights(PERIOD, context.patient)).status).toBe(403);
  });
});

describe('GET /api/admin/reports/export with insights', () => {
  it('adds the doctor and unit tables to the spreadsheet', async () => {
    const response = await exportOf('xlsx');
    const report = await insightsOf();
    const workbook = workbookOf(response.body as Buffer);

    expect(workbook.names).toEqual(['Resumo', 'Série', 'Especialidades', 'Exames', 'Médicos', 'Unidades']);
    expect(workbook.sheet(5)).toEqual([
      ['Médico', 'Total', 'Realizados', 'Faltas', 'Cancelados'],
      ...report.doctors.map(({ name, total, completed, noShow, cancelled }) => [
        name,
        total,
        completed,
        noShow,
        cancelled,
      ]),
    ]);
    expect(workbook.sheet(6)).toEqual([
      ['Unidade', 'Total', 'Consultas', 'Exames', 'Realizados', 'Faltas', 'Cancelados'],
      ...report.units.map(({ name, total, appointments, exams, completed, noShow, cancelled }) => [
        name,
        total,
        appointments,
        exams,
        completed,
        noShow,
        cancelled,
      ]),
    ]);
  });

  it('prints the pdf with the extra tables', async () => {
    const response = await exportOf('pdf');

    expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
