import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupClinic, type Clinic } from './support/doctors.js';
import { as, login } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };
const PATIENT = 'ana.silva@email.com';
const DEMO_PATIENT = 'paciente@saudemais.test';

let context: Clinic;
let admin: string;

interface Cancellation {
  role?: 'patient' | 'doctor' | 'admin' | 'system';
  late?: boolean;
}

interface Totals {
  total: number;
  pending: number;
  confirmed: number;
  awaitingRecord: number;
  completed: number;
  noShow: number;
  cancelled: number;
  expired: number;
}

interface Report {
  period: { from: string; to: string; granularity: 'day' | 'week' };
  appointments: Totals & { lateCancellations: number; cancelledBy: Record<string, number>; noShowRate: number | null };
  exams: Totals & { lateCancellations: number; cancelledBy: Record<string, number> };
  series: (Totals & { start: string })[];
  topSpecialties: { id: string; name: string; total: number }[];
  topExamTypes: { id: string; name: string; total: number }[];
}

const zero = {
  total: 0,
  pending: 0,
  confirmed: 0,
  awaitingRecord: 0,
  completed: 0,
  noShow: 0,
  cancelled: 0,
  expired: 0,
};

const cancellationColumns = (status: string, { role, late = false }: Cancellation) => sql`
  ${status}::text,
  case when ${status}::text = 'cancelled' then now() end,
  ${role ?? null}::text,
  case when ${role ?? null}::text <> 'system' then u.id end,
  case when ${role ?? null}::text = 'doctor' then 'Motivo do médico' end,
  ${late}
`;

function appointment(
  startsAt: string,
  status: string,
  {
    doctor = 'Dr. Carlos Mendes',
    email = PATIENT,
    ...cancellation
  }: Cancellation & { doctor?: string; email?: string } = {},
) {
  return context.db.execute(sql`
    insert into bookings (kind, patient_id, unit_id, doctor_id, specialty_id, visit_type, starts_at, ends_at,
      status, cancelled_at, cancelled_by_role, cancelled_by, cancel_reason, late_cancellation)
    select 'appointment', u.id, p.unit_id, p.user_id, p.specialty_id, 'routine', ${startsAt}::timestamptz,
      ${startsAt}::timestamptz + interval '30 minutes', ${cancellationColumns(status, cancellation)}
    from users u, doctor_profiles p join users d on d.id = p.user_id
    where u.email = ${email} and d.full_name = ${doctor}
  `);
}

function exam(code: string, publicCode: string, startsAt: string, status: string, cancellation: Cancellation = {}) {
  return context.db.execute(sql`
    insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at,
      status, cancelled_at, cancelled_by_role, cancelled_by, cancel_reason, late_cancellation)
    select 'exam', u.id, o.unit_id, o.exam_type_id, ${publicCode}, 1, ${startsAt}::timestamptz,
      ${startsAt}::timestamptz + interval '20 minutes', ${cancellationColumns(status, cancellation)}
    from users u, unit_exam_offers o join exam_types e on e.id = o.exam_type_id
    where u.email = ${PATIENT} and e.code = ${code}
    limit 1
  `);
}

const reports = (query: Record<string, string> = {}, token = admin) =>
  request(context.app).get('/api/admin/reports').query(query).set(as(token));

async function reportOf(query: Record<string, string> = {}) {
  const response = await reports(query).expect(200);
  return response.body as Report;
}

beforeAll(async () => {
  context = await setupClinic();
  await context.modules.users.bootstrap(ADMIN);
  admin = ((await login(context.app, ADMIN).expect(200)).body as { token: string }).token;

  await appointment('2026-11-10T02:30:00Z', 'completed');
  await appointment('2026-11-10T03:00:00Z', 'completed');
  await appointment('2026-11-12T13:00:00Z', 'no_show');
  await appointment('2026-11-12T14:00:00Z', 'completed', { doctor: 'Dra. Ana Ferreira' });
  await appointment('2026-11-15T13:00:00Z', 'pending', { doctor: 'Dra. Ana Ferreira' });
  await appointment('2026-11-18T13:00:00Z', 'cancelled', { role: 'doctor' });
  await appointment('2026-11-18T14:00:00Z', 'cancelled', { role: 'admin', doctor: 'Dra. Ana Ferreira' });
  await appointment('2026-11-18T15:00:00Z', 'cancelled', { role: 'system', doctor: 'Dra. Ana Ferreira' });
  await appointment('2026-11-20T11:00:00Z', 'confirmed');
  await appointment('2026-11-20T15:00:00Z', 'confirmed');
  await appointment('2026-11-20T16:00:00Z', 'pending', { doctor: 'Dra. Beatriz Lima' });
  await appointment('2026-11-20T17:00:00Z', 'cancelled', { role: 'patient', late: true });
  await appointment('2026-11-21T02:59:00Z', 'cancelled', { role: 'patient' });
  await appointment('2026-11-21T03:00:00Z', 'pending');
  await appointment('2026-11-12T16:00:00Z', 'completed', { email: DEMO_PATIENT });
  await exam('hemograma', 'EX-AAAAA1', '2026-11-11T12:00:00Z', 'completed');
  await exam('hemograma', 'EX-AAAAA2', '2026-11-13T12:00:00Z', 'completed');
  await exam('glicemia', 'EX-AAAAA3', '2026-11-16T12:00:00Z', 'cancelled', { role: 'patient' });
  await exam('glicemia', 'EX-AAAAA4', '2026-11-19T12:00:00Z', 'confirmed');
  await exam('glicemia', 'EX-AAAAA5', '2026-11-25T12:00:00Z', 'confirmed');
}, 60_000);

describe('GET /api/admin/reports', () => {
  it('totals the bookings of the period by current status, split by kind, without the demo ones', async () => {
    const response = await reports({ from: '2026-11-10', to: '2026-11-20' }).expect(200);
    const report = response.body as Report;

    expect(response.headers['cache-control']).toBe('no-store');
    expect(report.period).toEqual({ from: '2026-11-10', to: '2026-11-20', granularity: 'day' });
    expect(report.appointments).toEqual({
      total: 12,
      pending: 1,
      confirmed: 1,
      awaitingRecord: 1,
      completed: 2,
      noShow: 1,
      cancelled: 5,
      expired: 1,
      lateCancellations: 1,
      cancelledBy: { patient: 2, doctor: 1, admin: 1, system: 1 },
      noShowRate: 0.333,
    });
    expect(report.exams).toEqual({
      ...zero,
      total: 4,
      awaitingRecord: 1,
      completed: 2,
      cancelled: 1,
      lateCancellations: 0,
      cancelledBy: { patient: 1, doctor: 0, admin: 0, system: 0 },
    });
  });

  it('ranks specialties and exam types by volume, breaking ties by name', async () => {
    const report = await reportOf({ from: '2026-11-10', to: '2026-11-20' });

    expect(report.topSpecialties.map(({ name, total }) => ({ name, total }))).toEqual([
      { name: 'Cardiologia', total: 7 },
      { name: 'Nutrição', total: 4 },
      { name: 'Dermatologia', total: 1 },
    ]);
    expect(report.topExamTypes.map(({ name, total }) => ({ name, total }))).toEqual([
      { name: 'Glicemia', total: 2 },
      { name: 'Hemograma', total: 2 },
    ]);
  });

  it('keeps no personal data, notes or reasons', async () => {
    const response = await reports({ from: '2026-11-10', to: '2026-11-20' }).expect(200);

    expect(response.text).not.toContain(PATIENT);
    expect(response.text).not.toContain('Motivo');
    expect(response.text).not.toContain('Dr.');
  });

  it('cuts the days at midnight in São Paulo and fills a daily series with empty days', async () => {
    const report = await reportOf({ from: '2026-11-10', to: '2026-11-20' });

    expect(report.series).toHaveLength(11);
    expect(report.series[0]).toEqual({ ...zero, start: '2026-11-10', total: 1, completed: 1 });
    expect(report.series[1]).toEqual({ ...zero, start: '2026-11-11', total: 1, completed: 1 });
    expect(report.series[2]).toEqual({ ...zero, start: '2026-11-12', total: 2, completed: 1, noShow: 1 });
    expect(report.series[4]).toEqual({ ...zero, start: '2026-11-14' });
    expect(report.series[10]).toEqual({
      ...zero,
      start: '2026-11-20',
      total: 5,
      pending: 1,
      confirmed: 1,
      awaitingRecord: 1,
      cancelled: 2,
    });
  });

  it('groups the series by week from the first day when the period is longer than 62 days', async () => {
    const report = await reportOf({ from: '2026-09-01', to: '2026-11-20' });

    expect(report.period.granularity).toBe('week');
    expect(report.series).toHaveLength(12);
    expect(report.series.map(({ start }) => start).slice(-3)).toEqual(['2026-11-03', '2026-11-10', '2026-11-17']);
    expect(report.series.slice(-3).map(({ total }) => total)).toEqual([1, 7, 9]);
    expect(report.series.slice(0, 9).every(({ total }) => total === 0)).toBe(true);
    expect((await reportOf({ from: '2026-09-20', to: '2026-11-20' })).period.granularity).toBe('day');
  });

  it('defaults to the last 30 days up to today, or up to the given last day', async () => {
    const report = await reportOf();

    expect(report.period).toEqual({ from: '2026-10-22', to: '2026-11-20', granularity: 'day' });
    expect(report.series).toHaveLength(30);
    expect(report.appointments.total).toBe(13);
    expect((await reportOf({ to: '2026-11-15' })).period).toEqual({
      from: '2026-10-17',
      to: '2026-11-15',
      granularity: 'day',
    });
  });

  it('answers zeros and a null no-show rate for a period without bookings', async () => {
    const report = await reportOf({ from: '2026-01-01', to: '2026-01-07' });

    expect(report.appointments).toMatchObject({ ...zero, noShowRate: null });
    expect(report.exams).toMatchObject(zero);
    expect(report.topSpecialties).toEqual([]);
    expect(report.series).toHaveLength(7);
  });

  it('accepts up to 366 days and refuses longer, reversed or malformed periods', async () => {
    await reports({ from: '2025-11-20', to: '2026-11-20' }).expect(200);

    const refused = [
      await reports({ from: '2025-11-19', to: '2026-11-20' }),
      await reports({ from: '2026-11-20', to: '2026-11-19' }),
      await reports({ from: '20/11/2026' }),
      await reports({ day: '2026-11-20' }),
    ];

    expect(refused.map(({ status }) => status)).toEqual([400, 400, 400, 400]);
    expect(refused[0]?.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { to: 'Consulte no máximo 366 dias por vez.' },
    });
    expect(refused[1]?.body).toMatchObject({
      fields: { to: 'A data final precisa ser igual ou posterior à inicial.' },
    });
  });

  it('is only for admins', async () => {
    expect((await request(context.app).get('/api/admin/reports')).status).toBe(401);
    expect((await reports({}, context.patient)).status).toBe(403);
  });
});
