import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  availability,
  doctorNamed,
  setupClinic,
  type Availability,
  type Clinic,
  type Doctor,
} from './support/doctors.js';
import { as, createPatient, START } from './support/users.js';

interface Appointment {
  id: string;
  status: string;
  startsAt: string;
  actions: Record<string, unknown> | null;
  events: Record<string, unknown>[];
}

const UNKNOWN_ID = '0190a5d2-6b7e-7c3a-9f1e-2d4c6b8a0e13';

let context: Clinic;
let carlos: Doctor;
let ana: Doctor;
let admin: string;

beforeAll(async () => {
  context = await setupClinic();
  carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
  ana = await doctorNamed(context, 'Dra. Ana Ferreira');
  admin = await createPatient(context, 'admin.reagenda@email.com');
  await context.db.execute(sql`
    update user_roles set role = 'admin'
    where role = 'patient' and user_id = (select id from users where email = 'admin.reagenda@email.com')
  `);
}, 60_000);

const slot = (date: string, time: string) => `${date}T${time}:00.000Z`;

const book = (token: string, doctor: Doctor, startsAt: string) =>
  request(context.app)
    .post('/api/appointments')
    .set(as(token))
    .send({ doctorId: doctor.id, specialtyId: doctor.specialty.id, visitType: 'routine', startsAt });

const show = (token: string, id: string) => request(context.app).get(`/api/appointments/${id}`).set(as(token));

describe('POST /api/appointments/:id/reschedule', () => {
  const reschedule = (token: string, id: string, body: Record<string, unknown>) =>
    request(context.app).post(`/api/appointments/${id}/reschedule`).set(as(token)).send(body);

  const confirm = (id: string) => context.db.execute(sql`update bookings set status = 'confirmed' where id = ${id}`);

  async function booked(email: string, startsAt: string) {
    const token = await createPatient(context, email);
    const created = (await book(token, carlos, startsAt).expect(201)).body as Appointment;
    return { token, created };
  }

  async function freeSlots(token: string, date: string, query: Record<string, string> = {}) {
    const response = await availability(context, token, carlos.id, { from: date, to: date, ...query }).expect(200);
    return (response.body as Availability).days[0]?.slots.map((free) => free.startsAt) ?? [];
  }

  it('moves a pending request to a free slot, frees the old one and notifies the doctor after commit', async () => {
    const from = slot('2026-12-14', '11:00');
    const to = slot('2026-12-14', '12:00');
    const { token, created } = await booked('reagenda@email.com', from);
    const area = { userId: carlos.id, role: 'doctor' as const };
    const before = await context.modules.notifications.service.unreadCount(area);

    const response = await reschedule(token, created.id, { startsAt: from, newStartsAt: to });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const moved = response.body as Appointment;
    expect(moved).toMatchObject({
      id: created.id,
      status: 'pending',
      startsAt: to,
      endsAt: slot('2026-12-14', '12:30'),
      actions: { canReschedule: true, rescheduleBlockedReason: null, reschedulesLeft: 1 },
    });
    expect(moved.events.at(-1)).toEqual({
      type: 'rescheduled',
      actorType: 'patient',
      fromStatus: 'pending',
      toStatus: 'pending',
      fromStartsAt: from,
      toStartsAt: to,
      createdAt: START.toISOString(),
    });
    const rows = await context.db.execute<{ user_id: string; audience_role: string; params: unknown }>(sql`
      select user_id, audience_role, params from notifications
      where booking_id = ${created.id} and type = 'appointment_rescheduled'
    `);
    expect(rows.rows).toEqual([
      { user_id: carlos.id, audience_role: 'doctor', params: { startsAt: to, fromStartsAt: from } },
    ]);
    expect(await context.modules.notifications.service.unreadCount(area)).toBe(before + 1);
    const count = await context.db.execute<{ reschedule_count: number }>(
      sql`select reschedule_count from bookings where id = ${created.id}`,
    );
    expect(count.rows[0]?.reschedule_count).toBe(1);
    const free = await freeSlots(token, '2026-12-14');
    expect(free).toContain(from);
    expect(free).not.toContain(to);
  });

  it('sends a confirmed appointment back to pending', async () => {
    const from = slot('2026-12-15', '11:00');
    const { token, created } = await booked('reagenda.confirmada@email.com', from);
    await confirm(created.id);

    const moved = (
      await reschedule(token, created.id, { startsAt: from, newStartsAt: slot('2026-12-15', '13:00') }).expect(200)
    ).body as Appointment;

    expect(moved.status).toBe('pending');
    expect(moved.events.at(-1)).toMatchObject({ type: 'rescheduled', fromStatus: 'confirmed', toStatus: 'pending' });
  });

  it('answers 409 RESCHEDULE_WINDOW_CLOSED for a confirmed appointment inside the window, not for a pending one', async () => {
    const confirmedAt = slot('2026-11-20', '18:00');
    const pendingAt = slot('2026-11-20', '18:30');
    const { token, created } = await booked('janela.reagenda@email.com', confirmedAt);
    const pending = (await book(token, carlos, pendingAt).expect(201)).body as Appointment;
    await confirm(created.id);

    const closed = await reschedule(token, created.id, {
      startsAt: confirmedAt,
      newStartsAt: slot('2026-11-20', '19:00'),
    });
    const open = await reschedule(token, pending.id, { startsAt: pendingAt, newStartsAt: slot('2026-11-20', '19:30') });

    const message =
      'Falta pouco para o horário e este agendamento não pode mais ser reagendado. Você ainda pode cancelá-lo.';
    expect(closed.status).toBe(409);
    expect(closed.body).toEqual({ message, code: 'RESCHEDULE_WINDOW_CLOSED', fields: { _root: message } });
    expect(open.status).toBe(200);
    expect((await show(token, created.id)).body).toMatchObject({
      status: 'confirmed',
      startsAt: confirmedAt,
      actions: { lateCancellation: true, canReschedule: false, rescheduleBlockedReason: 'window_closed' },
    });
  });

  it('answers 409 RESCHEDULE_LIMIT once the reschedules allowed by the policy are used', async () => {
    const [first, second, third, fourth] = ['11:00', '11:30', '12:00', '12:30'].map((time) => slot('2026-12-17', time));
    const { token, created } = await booked('limite.reagenda@email.com', first ?? '');

    await reschedule(token, created.id, { startsAt: first, newStartsAt: second }).expect(200);
    const last = (await reschedule(token, created.id, { startsAt: second, newStartsAt: third }).expect(200))
      .body as Appointment;
    const response = await reschedule(token, created.id, { startsAt: third, newStartsAt: fourth });

    expect(last.actions).toMatchObject({ canReschedule: false, rescheduleBlockedReason: 'limit', reschedulesLeft: 0 });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Este agendamento já foi reagendado o máximo de vezes permitido.',
      code: 'RESCHEDULE_LIMIT',
      fields: { _root: 'Este agendamento já foi reagendado o máximo de vezes permitido.' },
    });
  });

  it('answers 409 INVALID_STATE for a stale start or a cancelled appointment', async () => {
    const from = slot('2026-12-18', '11:00');
    const to = slot('2026-12-18', '11:30');
    const { token, created } = await booked('reagenda.antiga@email.com', from);
    await reschedule(token, created.id, { startsAt: from, newStartsAt: to }).expect(200);

    const stale = await reschedule(token, created.id, { startsAt: from, newStartsAt: slot('2026-12-18', '12:00') });
    await request(context.app).post(`/api/appointments/${created.id}/cancel`).set(as(token)).send({ startsAt: to });
    const cancelled = await reschedule(token, created.id, { startsAt: to, newStartsAt: slot('2026-12-18', '12:00') });

    for (const response of [stale, cancelled]) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: 'Esta consulta mudou ou não pode mais ser reagendada. Atualize a página.',
        code: 'INVALID_STATE',
        fields: { _root: 'Esta consulta mudou ou não pode mais ser reagendada. Atualize a página.' },
      });
    }
  });

  it('answers 409 SLOT_TAKEN on an occupied slot and keeps the current one', async () => {
    const from = slot('2026-12-21', '11:00');
    const taken = slot('2026-12-21', '11:30');
    const { token, created } = await booked('reagenda.ocupada@email.com', from);
    await booked('dono.vaga@email.com', taken);

    const response = await reschedule(token, created.id, { startsAt: from, newStartsAt: taken });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Este horário acabou de ser ocupado. Escolha outra vaga.',
      code: 'SLOT_TAKEN',
      fields: { newStartsAt: 'Este horário acabou de ser ocupado. Escolha outra vaga.' },
    });
    expect((await show(token, created.id)).body).toMatchObject({ startsAt: from, events: [{ type: 'created' }] });
    expect(await freeSlots(token, '2026-12-21')).not.toContain(from);
  });

  it('answers 409 PATIENT_CONFLICT when the patient has another booking at the new time', async () => {
    const from = slot('2026-12-22', '11:00');
    const { token, created } = await booked('reagenda.conflito@email.com', from);
    await book(token, ana, slot('2026-12-22', '12:20')).expect(201);

    const response = await reschedule(token, created.id, { startsAt: from, newStartsAt: slot('2026-12-22', '12:00') });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'PATIENT_CONFLICT',
      fields: { newStartsAt: expect.any(String) as unknown },
    });
  });

  it('answers 422 OUTSIDE_AVAILABILITY and SAME_SLOT for a new start that is not another slot', async () => {
    const from = slot('2026-12-23', '11:00');
    const { token, created } = await booked('reagenda.fora@email.com', from);

    const outside = await reschedule(token, created.id, { startsAt: from, newStartsAt: slot('2026-12-23', '11:10') });
    const same = await reschedule(token, created.id, { startsAt: from, newStartsAt: from });

    expect(outside.status).toBe(422);
    expect(outside.body).toEqual({
      message: 'Este horário não é uma vaga do médico. Escolha uma vaga da lista.',
      code: 'OUTSIDE_AVAILABILITY',
      fields: { newStartsAt: 'Este horário não é uma vaga do médico. Escolha uma vaga da lista.' },
    });
    expect(same.status).toBe(422);
    expect(same.body).toMatchObject({
      code: 'SAME_SLOT',
      fields: { newStartsAt: 'Escolha um horário diferente do atual.' },
    });
  });

  it('answers 404 to other patients, 403 without the patient role and 400 to invalid bodies', async () => {
    const from = slot('2026-12-24', '11:00');
    const { token, created } = await booked('reagenda.alheia@email.com', from);
    const body = { startsAt: from, newStartsAt: slot('2026-12-24', '11:30') };

    expect((await reschedule(context.patient, created.id, body)).status).toBe(404);
    expect((await reschedule(context.patient, UNKNOWN_ID, body)).body).toMatchObject({ code: 'NOT_FOUND' });
    expect((await reschedule(admin, created.id, body)).status).toBe(403);
    expect((await reschedule(token, created.id, { startsAt: from })).status).toBe(400);
    expect((await reschedule(token, created.id, { ...body, extra: true })).status).toBe(400);
    expect((await show(token, created.id)).body).toMatchObject({ startsAt: from });
  });
});
