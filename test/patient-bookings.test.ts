import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { bookings, isLateCancellation } from '@/database/schema/bookings.js';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import {
  availability,
  doctorNamed,
  setupClinic,
  type Availability,
  type Clinic,
  type Doctor,
} from './support/doctors.js';
import { as, HOUR, login, signUp, START } from './support/users.js';

interface Booking {
  id: string;
  kind: string;
  status: string;
  startsAt: string;
  actions: Record<string, unknown>;
  [key: string]: unknown;
}

interface BookingPage {
  items: Booking[];
  page: number;
  pageSize: number;
  total: number;
  counts: { upcoming: number; past: number };
}

const UNKNOWN_ID = '0190a5d2-6b7e-7c3a-9f1e-2d4c6b8a0e13';

let context: Clinic;
let carlos: Doctor;
let demoDoctor: Doctor;
let doctorToken: string;
let admin: string;

beforeAll(async () => {
  context = await setupClinic();
  carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
  demoDoctor = await doctorNamed(context, DEMO_DOCTOR.fullName);
  const doctorLogin = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
  doctorToken = (doctorLogin.body as { token: string }).token;
  admin = await signUp(context.app, 'admin.reservas@email.com');
  await context.db.execute(sql`
    update user_roles set role = 'admin'
    where role = 'patient' and user_id = (select id from users where email = 'admin.reservas@email.com')
  `);
}, 60_000);

const slot = (date: string, time: string) => `${date}T${time}:00.000Z`;

async function book(token: string, startsAt: string, doctor = carlos): Promise<Booking> {
  const response = await request(context.app)
    .post('/api/appointments')
    .set(as(token))
    .send({ doctorId: doctor.id, specialtyId: doctor.specialty.id, visitType: 'routine', startsAt })
    .expect(201);
  return response.body as Booking;
}

const list = (token: string, query: Record<string, string | number> = {}) =>
  request(context.app).get('/api/patient/bookings').query(query).set(as(token));

const home = (token: string) => request(context.app).get('/api/patient/home').set(as(token));

const cancel = (token: string, id: string, body: Record<string, unknown>) =>
  request(context.app).post(`/api/appointments/${id}/cancel`).set(as(token)).send(body);

const confirm = (id: string) => context.db.execute(sql`update bookings set status = 'confirmed' where id = ${id}`);

const moveBack = (id: string, days: number) =>
  context.db.execute(sql`
    update bookings set starts_at = starts_at - make_interval(days => ${days}), ends_at = ends_at - make_interval(days => ${days})
    where id = ${id}
  `);

async function withLateWindow<T>(hours: number, work: () => Promise<T>, examHours = 2): Promise<T> {
  await context.db.execute(
    sql`update settings set appointment_late_window_hours = ${hours}, exam_late_window_hours = ${examHours}`,
  );
  try {
    return await work();
  } finally {
    await context.db.execute(sql`update settings set appointment_late_window_hours = 24, exam_late_window_hours = 2`);
  }
}

describe('patient routes', () => {
  it('require a session and the patient role', async () => {
    for (const path of ['/api/patient/bookings', '/api/patient/home']) {
      expect((await request(context.app).get(path)).status, path).toBe(401);
      const forbidden = await request(context.app).get(path).set(as(admin));
      expect(forbidden.status, path).toBe(403);
      expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('GET /api/patient/bookings', () => {
  let patient: string;
  let pending: Booking;
  let confirmed: Booking;
  let expired: Booking;
  let cancelled: Booking;
  let exam: string;

  beforeAll(async () => {
    patient = await signUp(context.app, 'lista@email.com');
    pending = await book(patient, slot('2026-11-23', '11:00'));
    confirmed = await book(patient, slot('2026-11-24', '11:00'));
    expired = await book(patient, slot('2026-11-25', '11:00'));
    cancelled = await book(patient, slot('2026-11-26', '11:00'));
    await confirm(confirmed.id);
    await moveBack(expired.id, 10);
    await cancel(patient, cancelled.id, { startsAt: cancelled.startsAt }).expect(200);
    const rows = await context.db.execute<{ id: string }>(sql`
      insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
      select 'exam', u.id, o.unit_id, o.exam_type_id, 'EX-7F3K2Q', 1, '2026-11-27T12:00:00Z', '2026-11-27T12:20:00Z', 'confirmed'
      from users u, (select unit_id, exam_type_id from unit_exam_offers limit 1) o
      where u.email = 'lista@email.com'
      returning id
    `);
    exam = rows.rows[0]?.id ?? '';
  });

  it('lists upcoming bookings soonest first with the allowed actions and both tab counts', async () => {
    const response = await list(patient);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const page = response.body as BookingPage;
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 3, counts: { upcoming: 3, past: 2 } });
    expect(page.items.map((item) => item.id)).toEqual([pending.id, confirmed.id, exam]);
    expect(page.items[0]).toEqual({
      id: pending.id,
      kind: 'appointment',
      status: 'pending',
      startsAt: '2026-11-23T11:00:00.000Z',
      endsAt: '2026-11-23T11:30:00.000Z',
      notes: null,
      visitType: 'routine',
      doctor: { id: carlos.id, fullName: 'Dr. Carlos Mendes' },
      specialty: carlos.specialty,
      examType: null,
      publicCode: null,
      unit: carlos.unit,
      cancellation: null,
      actions: {
        canCancel: true,
        lateCancellation: false,
        cancelBlockedReason: null,
        canReschedule: true,
        rescheduleBlockedReason: null,
        reschedulesLeft: 2,
      },
    });
    expect(page.items[1]).toMatchObject({ status: 'confirmed', actions: { canCancel: true, lateCancellation: false } });
  });

  it('shows exams with their type and public code and filters by kind', async () => {
    const page = (await list(patient, { kind: 'exam' }).expect(200)).body as BookingPage;

    expect(page.total).toBe(1);
    expect(page.counts).toEqual({ upcoming: 3, past: 2 });
    expect(page.items[0]).toMatchObject({
      id: exam,
      kind: 'exam',
      status: 'confirmed',
      visitType: null,
      doctor: null,
      specialty: null,
      examType: { id: expect.any(String) as unknown, name: expect.any(String) as unknown },
      publicCode: 'EX-7F3K2Q',
      unit: { address: expect.any(String) as unknown, phone: expect.any(String) as unknown },
      actions: {
        canCancel: true,
        lateCancellation: false,
        cancelBlockedReason: null,
        canReschedule: true,
        rescheduleBlockedReason: null,
        reschedulesLeft: 2,
      },
    });
  });

  it('measures the late window of exams with the exam setting, excluding the exact boundary', async () => {
    const lateAt = async (now: Date) => {
      const [row] = await context.db
        .select({ late: isLateCancellation(now) })
        .from(bookings)
        .where(eq(bookings.id, exam));
      return row?.late;
    };

    const results = await withLateWindow(
      0,
      async () => [await lateAt(START), await lateAt(new Date(START.getTime() + HOUR))],
      168,
    );
    const withDefault = await lateAt(new Date(START.getTime() + HOUR));

    expect(results).toEqual([false, true]);
    expect(withDefault).toBe(false);
  });

  it('lists past bookings most recent first with the computed expired status', async () => {
    const page = (await list(patient, { scope: 'past' }).expect(200)).body as BookingPage;

    expect(page.items.map((item) => [item.id, item.status])).toEqual([
      [cancelled.id, 'cancelled'],
      [expired.id, 'expired'],
    ]);
    expect(page.items[0]?.cancellation).toEqual({
      byRole: 'patient',
      reason: null,
      late: false,
      cancelledAt: START.toISOString(),
    });
    expect(page.items[1]?.cancellation).toBeNull();
    for (const item of page.items) {
      expect(item.actions).toEqual({
        canCancel: false,
        lateCancellation: false,
        cancelBlockedReason: 'closed',
        canReschedule: false,
        rescheduleBlockedReason: 'closed',
        reschedulesLeft: 2,
      });
    }
  });

  it('filters by effective status and paginates', async () => {
    const expiredOnly = (await list(patient, { scope: 'past', status: 'expired' }).expect(200)).body as BookingPage;
    const pendingInPast = (await list(patient, { scope: 'past', status: 'pending' }).expect(200)).body as BookingPage;
    const second = (await list(patient, { pageSize: 1, page: 2 }).expect(200)).body as BookingPage;

    expect(expiredOnly.items.map((item) => item.id)).toEqual([expired.id]);
    expect(pendingInPast.total).toBe(0);
    expect(second).toMatchObject({ page: 2, pageSize: 1, total: 3 });
    expect(second.items.map((item) => item.id)).toEqual([confirmed.id]);
  });

  it('shows only the bookings of the logged patient', async () => {
    const page = (await list(context.patient).expect(200)).body as BookingPage;

    expect(page.items.some((item) => item.id === pending.id)).toBe(false);
  });

  it('rejects invalid filters with 400', async () => {
    for (const query of [{ scope: 'all' }, { kind: 'surgery' }, { status: 'done' }, { pageSize: 51 }, { extra: 1 }]) {
      const response = await list(patient, query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

describe('allowed actions', () => {
  it('flags a confirmed booking inside the late window and blocks it once it has started', async () => {
    const patient = await signUp(context.app, 'acoes@email.com');
    const late = await book(patient, slot('2026-11-23', '13:00'));
    const early = await book(patient, slot('2026-11-23', '13:30'));
    await confirm(late.id);

    const items = await withLateWindow(96, async () => ((await list(patient).expect(200)).body as BookingPage).items);

    expect(items.find((item) => item.id === late.id)?.actions).toEqual({
      canCancel: true,
      lateCancellation: true,
      cancelBlockedReason: null,
      canReschedule: false,
      rescheduleBlockedReason: 'window_closed',
      reschedulesLeft: 2,
    });
    expect(items.find((item) => item.id === early.id)?.actions.lateCancellation).toBe(false);

    await moveBack(late.id, 4);
    const past = ((await list(patient, { scope: 'past', status: 'confirmed' }).expect(200)).body as BookingPage).items;
    expect(past).toHaveLength(1);
    expect(past[0]).toMatchObject({
      id: late.id,
      status: 'confirmed',
      actions: {
        canCancel: false,
        lateCancellation: false,
        cancelBlockedReason: 'started',
        rescheduleBlockedReason: 'started',
      },
    });
  });

  it('does not flag a booking that starts exactly at the window boundary', async () => {
    const patient = await signUp(context.app, 'limite.janela@email.com');
    const booked = await book(patient, slot('2026-11-23', '12:00'));
    await confirm(booked.id);
    const lateWith = (hours: number) =>
      withLateWindow(hours, async () => ((await list(patient).expect(200)).body as BookingPage).items[0]?.actions);

    expect((await lateWith(72))?.lateCancellation).toBe(false);
    expect((await lateWith(73))?.lateCancellation).toBe(true);
  });
});

describe('GET /api/patient/home', () => {
  it('shows the next three bookings, the tab counts and no notice for a new patient', async () => {
    const patient = await signUp(context.app, 'inicio@email.com');
    const times = ['11:00', '11:30', '12:00', '12:30'];
    const booked = [];
    for (const time of times) booked.push(await book(patient, slot('2026-11-30', time)));

    const response = await home(patient);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as { upcoming: Booking[]; counts: unknown; lastNotification: unknown };
    expect(body.upcoming.map((item) => item.id)).toEqual(booked.slice(0, 3).map((item) => item.id));
    expect(body.counts).toEqual({ upcoming: 4, past: 0 });
    expect(body.lastNotification).toBeNull();
  });
});

describe('POST /api/appointments/:id/cancel', () => {
  it('lets the patient cancel, notifies the doctor and frees the slot', async () => {
    const patient = await signUp(context.app, 'cancela@email.com');
    const booked = await book(patient, slot('2026-12-01', '11:00'));
    await confirm(booked.id);

    const response = await cancel(patient, booked.id, {
      startsAt: booked.startsAt,
      reason: '  Viagem\r\na trabalho.  ',
    });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      id: booked.id,
      status: 'cancelled',
      cancellation: {
        byRole: 'patient',
        reason: 'Viagem\r\na trabalho.',
        late: false,
        cancelledAt: START.toISOString(),
      },
    });
    expect((response.body as { events: unknown[] }).events.at(-1)).toMatchObject({
      type: 'cancelled',
      actorType: 'patient',
      fromStatus: 'confirmed',
      toStatus: 'cancelled',
    });
    const rows = await context.db.execute(sql`
      select b.cancelled_by_role, b.cancel_reason, b.late_cancellation, n.user_id, n.audience_role, n.type, n.params
      from bookings b join notifications n on n.booking_id = b.id and n.type <> 'appointment_requested'
      where b.id = ${booked.id}
    `);
    expect(rows.rows).toEqual([
      {
        cancelled_by_role: 'patient',
        cancel_reason: 'Viagem\r\na trabalho.',
        late_cancellation: false,
        user_id: carlos.id,
        audience_role: 'doctor',
        type: 'appointment_cancelled_by_patient',
        params: { startsAt: booked.startsAt, cancelledByRole: 'patient' },
      },
    ]);
    const days = (
      (await availability(context, patient, carlos.id, { from: '2026-12-01', to: '2026-12-01' }).expect(200))
        .body as Availability
    ).days;
    expect(days[0]?.slots[0]?.startsAt).toBe(booked.startsAt);
  });

  it('marks a confirmed booking cancelled by the patient inside the window as late, but not a pending one', async () => {
    const patient = await signUp(context.app, 'tardio@email.com');
    const confirmed = await book(patient, slot('2026-11-23', '14:00'));
    const pending = await book(patient, slot('2026-11-23', '14:30'));
    await confirm(confirmed.id);

    await withLateWindow(96, async () => {
      await cancel(patient, confirmed.id, { startsAt: confirmed.startsAt }).expect(200);
      await cancel(patient, pending.id, { startsAt: pending.startsAt }).expect(200);
    });

    const rows = await context.db.execute<{ id: string; late_cancellation: boolean; cancel_reason: string | null }>(
      sql`select id, late_cancellation, cancel_reason from bookings where id in (${confirmed.id}, ${pending.id})`,
    );
    const late = Object.fromEntries(rows.rows.map((row) => [row.id, row.late_cancellation]));
    expect(late).toEqual({ [confirmed.id]: true, [pending.id]: false });
    expect(rows.rows.every((row) => row.cancel_reason === null)).toBe(true);
  });

  it('requires a reason from the doctor, never flags it late and notifies the patient', async () => {
    const booked = await book(context.demoPatient, slot('2026-11-23', '11:00'), demoDoctor);
    await confirm(booked.id);

    const missing = await cancel(doctorToken, booked.id, { startsAt: booked.startsAt, reason: '   ' });
    const response = await withLateWindow(96, () =>
      cancel(doctorToken, booked.id, { startsAt: booked.startsAt, reason: 'Congresso médico.' }),
    );

    expect(missing.status).toBe(422);
    expect(missing.body).toEqual({
      message: 'Informe o motivo do cancelamento.',
      code: 'REASON_REQUIRED',
      fields: { reason: 'Informe o motivo do cancelamento.' },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      cancellation: { byRole: 'doctor', reason: 'Congresso médico.', late: false },
    });
    expect((response.body as { events: unknown[] }).events.at(-1)).toMatchObject({ actorType: 'doctor' });
    const rows = await context.db.execute(sql`
      select b.cancelled_by_role, b.cancel_reason, b.late_cancellation, n.audience_role, n.type, n.params
      from bookings b join notifications n on n.booking_id = b.id and n.type <> 'appointment_requested'
      where b.id = ${booked.id}
    `);
    expect(rows.rows).toEqual([
      {
        cancelled_by_role: 'doctor',
        cancel_reason: 'Congresso médico.',
        late_cancellation: false,
        audience_role: 'patient',
        type: 'appointment_cancelled',
        params: { startsAt: booked.startsAt, cancelledByRole: 'doctor' },
      },
    ]);
    const patientHome = (await home(context.demoPatient).expect(200)).body as {
      lastNotification: { type: string; bookingId: string };
    };
    expect(patientHome.lastNotification).toMatchObject({ type: 'appointment_cancelled', bookingId: booked.id });
  });

  it('answers 404 to other users and 403 to accounts without a patient or doctor profile', async () => {
    const booked = await book(context.demoPatient, slot('2026-12-14', '12:00'), demoDoctor);
    const body = { startsAt: booked.startsAt, reason: 'Motivo.' };

    const carlosBooking = await book(context.patient, slot('2026-12-04', '11:00'));
    const otherDoctor = await cancel(doctorToken, carlosBooking.id, { startsAt: carlosBooking.startsAt, reason: 'x' });
    const stranger = await cancel(context.patient, booked.id, body);
    const unknown = await cancel(context.patient, UNKNOWN_ID, body);
    const forbidden = await cancel(admin, booked.id, body);

    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual({ message: 'Consulta não encontrada.', code: 'NOT_FOUND' });
    expect(unknown.status).toBe(404);
    expect(otherDoctor.status).toBe(404);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('answers 409 INVALID_STATE for a stale start, a cancelled booking or one that has started', async () => {
    const patient = await signUp(context.app, 'estado@email.com');
    const stale = await book(patient, slot('2026-12-02', '11:00'));
    const started = await book(patient, slot('2026-12-02', '11:30'));
    await confirm(started.id);
    await moveBack(started.id, 13);

    const responses = [
      await cancel(patient, stale.id, { startsAt: slot('2026-12-02', '12:00') }),
      await cancel(patient, started.id, { startsAt: '2026-11-19T11:30:00.000Z' }),
    ];
    await cancel(patient, stale.id, { startsAt: stale.startsAt }).expect(200);
    responses.push(await cancel(patient, stale.id, { startsAt: stale.startsAt }));

    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: 'Esta consulta mudou ou não pode mais ser cancelada. Atualize a página.',
        code: 'INVALID_STATE',
        fields: { _root: 'Esta consulta mudou ou não pode mais ser cancelada. Atualize a página.' },
      });
    }
    const status = await context.db.execute<{ status: string }>(
      sql`select status from bookings where id = ${started.id}`,
    );
    expect(status.rows[0]?.status).toBe('confirmed');
  });

  it('rejects invalid bodies with 400', async () => {
    const booked = await book(context.patient, slot('2026-12-03', '11:00'));
    const invalid = [
      {},
      { startsAt: '2026-12-03 11:00' },
      { startsAt: booked.startsAt, reason: 'a'.repeat(501) },
      { startsAt: booked.startsAt, reason: 'linha\u0000nula' },
      { startsAt: booked.startsAt, extra: true },
    ];

    for (const body of invalid) {
      const response = await cancel(context.patient, booked.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect((await cancel(context.patient, 'abc', { startsAt: booked.startsAt })).status).toBe(400);
  });
});
