import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupClinic, type Clinic } from './support/doctors.js';
import { offerOf, type Offer } from './support/exams.js';
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

const slot = (date: string, time: string) => `${date}T${time}:00.000Z`;

async function booked(email: string, startsAt: string): Promise<{ token: string; exam: ExamBooking }> {
  const token = await createPatient(context, email);
  const response = await request(context.app)
    .post('/api/exam-bookings')
    .set(as(token))
    .send({ ...hemograma, startsAt })
    .expect(201);
  return { token, exam: response.body as ExamBooking };
}

const reschedule = (token: string, id: string, body: Record<string, unknown>) =>
  request(context.app).post(`/api/exam-bookings/${id}/reschedule`).set(as(token)).send(body);

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
    const { token, exam } = await booked('exame.reagenda@email.com', from);

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
    const { token, exam } = await booked('exame.raia.dois@email.com', from);
    const first = await booked('exame.raia.livre@email.com', to);
    await booked('exame.raia.ocupada@email.com', to);
    await request(context.app)
      .post(`/api/exam-bookings/${first.exam.id}/cancel`)
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
    const { token, exam } = await booked('exame.sem.lugar@email.com', from);

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
    const { token, exam } = await booked('exame.janela@email.com', soon);
    const other = await createPatient(context, 'exame.alheio@email.com');
    const body = { startsAt: soon, newStartsAt: slot('2026-11-20', '15:00') };

    const closed = await reschedule(token, exam.id, body);
    const stranger = await reschedule(other, exam.id, body);

    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: 'RESCHEDULE_WINDOW_CLOSED' });
    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual({ message: 'Exame não encontrado.', code: 'NOT_FOUND' });
  });
});
