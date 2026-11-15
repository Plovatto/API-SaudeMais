import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupClinic, type Clinic } from './support/doctors.js';
import { offerOf, type Offer } from './support/exams.js';
import { bookedBy, rescheduleOn, slot } from './support/bookings.js';
import { as, createPatient, START } from './support/users.js';

interface ExamBooking {
  id: string;
  status: string;
  publicCode: string;
  startsAt: string;
  actions: Record<string, unknown>;
  events: Record<string, unknown>[];
}

interface ExamAvailability {
  days: { date: string; slots: { startsAt: string; remaining: number }[] }[];
}

let context: Clinic;
let hemograma: Offer;

beforeAll(async () => {
  context = await setupClinic();
  hemograma = await offerOf(context, 'Unidade Central', 'hemograma');
}, 60_000);

const booked = (email: string, startsAt: string) =>
  bookedBy<ExamBooking>(context, email, '/api/exam-bookings', { ...hemograma, startsAt });

const reschedule = (token: string, id: string, move: Record<string, unknown>) =>
  rescheduleOn(context, '/api/exam-bookings', token, id, move);

async function laneOf(id: string) {
  const rows = await context.db.execute<{ lane: number }>(sql`select lane from bookings where id = ${id}`);
  return rows.rows[0]?.lane;
}

async function remainingAt(token: string, startsAt: string, query: Record<string, string> = {}) {
  const date = startsAt.slice(0, 10);
  const response = await request(context.app)
    .get('/api/exam-availability')
    .query({ ...hemograma, from: date, to: date, ...query })
    .set(as(token))
    .expect(200);
  const slots = (response.body as ExamAvailability).days.flatMap((day) => day.slots);
  return slots.find((free) => free.startsAt === startsAt)?.remaining ?? 0;
}

describe('POST /api/exam-bookings/:id/reschedule', () => {
  it('keeps the exam confirmed with its code and its lane when that lane is free at the new time', async () => {
    const from = slot('2026-12-14', '10:00');
    const to = slot('2026-12-14', '10:30');
    await booked('exame.primeiro@email.com', from);
    const { token, booking: exam } = await booked('exame.reagenda@email.com', from);

    const response = await reschedule(token, exam.id, { startsAt: from, newStartsAt: to });

    expect(response.status).toBe(200);
    const moved = response.body as ExamBooking;
    expect(moved).toMatchObject({
      id: exam.id,
      status: 'confirmed',
      publicCode: exam.publicCode,
      startsAt: to,
      endsAt: slot('2026-12-14', '10:40'),
      actions: { canReschedule: true, reschedulesLeft: 1 },
    });
    expect(moved.events.at(-1)).toEqual({
      type: 'rescheduled',
      actorType: 'patient',
      fromStatus: 'confirmed',
      toStatus: 'confirmed',
      fromStartsAt: from,
      toStartsAt: to,
      createdAt: START.toISOString(),
    });
    expect(await laneOf(exam.id)).toBe(2);
    expect(await remainingAt(token, from)).toBe(3);
    expect(await remainingAt(token, to)).toBe(3);
  });

  it('takes the lowest free lane when its own lane is taken at the new time', async () => {
    const from = slot('2026-12-15', '10:00');
    const to = slot('2026-12-15', '10:30');
    await booked('exame.raia.um@email.com', from);
    const { token, booking: exam } = await booked('exame.raia.dois@email.com', from);
    const first = await booked('exame.raia.livre@email.com', to);
    await booked('exame.raia.ocupada@email.com', to);
    await request(context.app)
      .post(`/api/exam-bookings/${first.booking.id}/cancel`)
      .set(as(first.token))
      .send({ startsAt: to })
      .expect(200);

    await reschedule(token, exam.id, { startsAt: from, newStartsAt: to }).expect(200);

    expect(await laneOf(exam.id)).toBe(1);
  });

  it('answers 409 NO_CAPACITY when the new slot is full and keeps the current place', async () => {
    const full = slot('2026-12-16', '10:00');
    const from = slot('2026-12-16', '10:30');
    for (const index of [1, 2, 3, 4]) await booked(`exame.lotado.${index}@email.com`, full);
    const { token, booking: exam } = await booked('exame.sem.lugar@email.com', from);

    const response = await reschedule(token, exam.id, { startsAt: from, newStartsAt: full });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Não há mais lugares neste horário. Escolha outra vaga.',
      code: 'NO_CAPACITY',
      fields: { newStartsAt: 'Não há mais lugares neste horário. Escolha outra vaga.' },
    });
    expect(await remainingAt(token, from)).toBe(3);
  });

  it('answers 409 RESCHEDULE_WINDOW_CLOSED inside the exam window and 404 to other patients', async () => {
    const soon = slot('2026-11-20', '13:00');
    const { token, booking: exam } = await booked('exame.janela@email.com', soon);
    const other = await createPatient(context, 'exame.alheio@email.com');
    const body = { startsAt: soon, newStartsAt: slot('2026-11-20', '15:00') };

    const closed = await reschedule(token, exam.id, body);
    const stranger = await reschedule(other, exam.id, body);

    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: 'RESCHEDULE_WINDOW_CLOSED' });
    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual({ message: 'Exame não encontrado.', code: 'NOT_FOUND' });
  });

  it('counts the place of the exam being rescheduled as free only for its patient', async () => {
    const startsAt = slot('2026-12-17', '10:00');
    const { token, booking: exam } = await booked('exame.vagas@email.com', startsAt);
    const other = await createPatient(context, 'exame.vagas.outro@email.com');
    const rescheduling = { rescheduling: exam.id };

    expect(await remainingAt(token, startsAt)).toBe(3);
    expect(await remainingAt(token, startsAt, rescheduling)).toBe(4);
    expect(await remainingAt(other, startsAt, rescheduling)).toBe(3);
  });

  it('answers 409 RESCHEDULE_LIMIT once the reschedules allowed by the policy are used', async () => {
    const [first, second, third, fourth] = ['10:00', '10:10', '10:20', '10:30'].map((time) => slot('2026-12-18', time));
    const { token, booking: exam } = await booked('exame.limite@email.com', first ?? '');

    await reschedule(token, exam.id, { startsAt: first, newStartsAt: second }).expect(200);
    await reschedule(token, exam.id, { startsAt: second, newStartsAt: third }).expect(200);
    const response = await reschedule(token, exam.id, { startsAt: third, newStartsAt: fourth });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'RESCHEDULE_LIMIT' });
  });

  it('answers 409 INVALID_STATE for a stale start or a cancelled exam', async () => {
    const from = slot('2026-12-21', '10:00');
    const to = slot('2026-12-21', '10:30');
    const { token, booking: exam } = await booked('exame.antigo@email.com', from);
    await reschedule(token, exam.id, { startsAt: from, newStartsAt: to }).expect(200);

    const stale = await reschedule(token, exam.id, { startsAt: from, newStartsAt: slot('2026-12-21', '11:00') });
    await request(context.app).post(`/api/exam-bookings/${exam.id}/cancel`).set(as(token)).send({ startsAt: to });
    const cancelled = await reschedule(token, exam.id, { startsAt: to, newStartsAt: slot('2026-12-21', '11:00') });

    for (const response of [stale, cancelled]) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: 'Este exame mudou ou não pode mais ser reagendado. Atualize a página.',
        code: 'INVALID_STATE',
        fields: { _root: 'Este exame mudou ou não pode mais ser reagendado. Atualize a página.' },
      });
    }
  });

  it('answers 422 OUTSIDE_AVAILABILITY and SAME_SLOT for a new start that is not another slot', async () => {
    const from = slot('2026-12-22', '10:00');
    const { token, booking: exam } = await booked('exame.fora@email.com', from);

    const outside = await reschedule(token, exam.id, { startsAt: from, newStartsAt: slot('2026-12-22', '10:05') });
    const same = await reschedule(token, exam.id, { startsAt: from, newStartsAt: from });

    expect(outside.status).toBe(422);
    expect(outside.body).toEqual({
      message: 'Este horário não é uma vaga do exame. Escolha uma vaga da lista.',
      code: 'OUTSIDE_AVAILABILITY',
      fields: { newStartsAt: 'Este horário não é uma vaga do exame. Escolha uma vaga da lista.' },
    });
    expect(same.status).toBe(422);
    expect(same.body).toMatchObject({ code: 'SAME_SLOT' });
  });
});
