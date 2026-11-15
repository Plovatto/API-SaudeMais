import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as publicCode from '@/modules/exam-bookings/exam-bookings.code.js';
import { newPublicCode } from '@/modules/exam-bookings/exam-bookings.code.js';
import { doctorNamed, setupClinic, type Clinic } from './support/doctors.js';
import { as, createPatient, HOUR, START } from './support/users.js';

vi.mock('@/modules/exam-bookings/exam-bookings.code.js', async (importOriginal) => {
  const original = await importOriginal<typeof publicCode>();
  return { newPublicCode: vi.fn(original.newPublicCode) };
});

interface ExamBooking {
  id: string;
  status: string;
  publicCode: string;
  startsAt: string;
  endsAt: string;
  cancellation: { byRole: string; reason: string | null; late: boolean; cancelledAt: string } | null;
  events: { type: string; toStatus: string }[];
  [key: string]: unknown;
}

interface ExamAvailability {
  days: { date: string; slots: { startsAt: string; endsAt: string; remaining: number }[] }[];
}

interface Offer {
  unitId: string;
  examTypeId: string;
}

const UNKNOWN_ID = '0190a5d2-6b7e-7c3a-9f1e-2d4c6b8a0e13';
const PUBLIC_CODE = /^EX-[0-9A-HJKMNP-TV-Z]{6}$/;

let context: Clinic;
let admin: string;
let centralUnit: { id: string; name: string; address: string; phone: string };
let hemograma: Offer;
let ultrassom: Offer;
let raioX: Offer;
let glicemia: Offer;
let southUltrassom: Offer;

async function offerOf(unit: string, code: string): Promise<Offer> {
  const rows = await context.db.execute<{ unit_id: string; exam_type_id: string }>(sql`
    select o.unit_id, o.exam_type_id from unit_exam_offers o
    join units u on u.id = o.unit_id join exam_types e on e.id = o.exam_type_id
    where u.name = ${unit} and e.code = ${code}
  `);
  const row = rows.rows[0];
  if (!row) throw new Error(`${unit} does not offer ${code}`);
  return { unitId: row.unit_id, examTypeId: row.exam_type_id };
}

beforeAll(async () => {
  context = await setupClinic();
  admin = await createPatient(context, 'admin.exames@email.com');
  await context.db.execute(sql`
    update user_roles set role = 'admin'
    where role = 'patient' and user_id = (select id from users where email = 'admin.exames@email.com')
  `);
  hemograma = await offerOf('Unidade Central', 'hemograma');
  ultrassom = await offerOf('Unidade Central', 'ultrassom');
  raioX = await offerOf('Unidade Central', 'raio_x');
  glicemia = await offerOf('Unidade Central', 'glicemia');
  southUltrassom = await offerOf('Unidade Sul', 'ultrassom');
  centralUnit = (await doctorNamed(context, 'Dr. Carlos Mendes')).unit;
}, 60_000);

const slot = (date: string, time: string) => `${date}T${time}:00.000Z`;

const availability = (token: string, offer: Offer, from: string, to = from) =>
  request(context.app)
    .get('/api/exam-availability')
    .query({ ...offer, from, to })
    .set(as(token));

const book = (token: string, offer: Offer, startsAt: string, notes?: string) =>
  request(context.app)
    .post('/api/exam-bookings')
    .set(as(token))
    .send({ ...offer, startsAt, ...(notes !== undefined && { notes }) });

const show = (token: string, id: string) => request(context.app).get(`/api/exam-bookings/${id}`).set(as(token));

const cancel = (token: string, id: string, startsAt: string) =>
  request(context.app).post(`/api/exam-bookings/${id}/cancel`).set(as(token)).send({ startsAt });

async function slotsOn(token: string, offer: Offer, date: string) {
  const body = (await availability(token, offer, date).expect(200)).body as ExamAvailability;
  return body.days.find((day) => day.date === date)?.slots ?? [];
}

async function booked(token: string, offer: Offer, startsAt: string): Promise<ExamBooking> {
  return (await book(token, offer, startsAt).expect(201)).body as ExamBooking;
}

async function laneOf(id: string) {
  const rows = await context.db.execute<{ lane: number }>(sql`select lane from bookings where id = ${id}`);
  return rows.rows[0]?.lane;
}

async function withExamDuration<T>(offer: Offer, minutes: number, work: () => Promise<T>): Promise<T> {
  const [row] = (
    await context.db.execute<{ duration_min: number }>(
      sql`select duration_min from exam_types where id = ${offer.examTypeId}`,
    )
  ).rows;
  await context.db.execute(sql`update exam_types set duration_min = ${minutes} where id = ${offer.examTypeId}`);
  try {
    return await work();
  } finally {
    await context.db.execute(
      sql`update exam_types set duration_min = ${row?.duration_min ?? minutes} where id = ${offer.examTypeId}`,
    );
  }
}

async function withInactive<T>(table: 'units' | 'exam_types' | 'offer', offer: Offer, work: () => Promise<T>) {
  const toggle = (active: boolean) => {
    if (table === 'units') return sql`update units set is_active = ${active} where id = ${offer.unitId}`;
    if (table === 'exam_types') return sql`update exam_types set is_active = ${active} where id = ${offer.examTypeId}`;
    return sql`
      update unit_exam_offers set is_active = ${active}
      where unit_id = ${offer.unitId} and exam_type_id = ${offer.examTypeId}
    `;
  };
  await context.db.execute(toggle(false));
  try {
    return await work();
  } finally {
    await context.db.execute(toggle(true));
  }
}

describe('exam routes', () => {
  it('require a session and the patient role', async () => {
    const calls = [
      () =>
        request(context.app)
          .get('/api/exam-availability')
          .query({ ...hemograma, from: '2026-11-23', to: '2026-11-23' }),
      () => request(context.app).post('/api/exam-bookings').send({}),
      () => request(context.app).get(`/api/exam-bookings/${UNKNOWN_ID}`),
      () => request(context.app).post(`/api/exam-bookings/${UNKNOWN_ID}/cancel`).send({}),
    ];
    for (const call of calls) {
      expect((await call()).status).toBe(401);
      const forbidden = await call().set(as(admin));
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('GET /api/exam-availability', () => {
  it('steps through the unit hours by the exam duration with every place free', async () => {
    const response = await availability(context.patient, hemograma, '2026-11-23');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const slots = (response.body as ExamAvailability).days[0]?.slots ?? [];
    expect(slots).toHaveLength(72);
    expect(slots[0]).toEqual({
      startsAt: slot('2026-11-23', '10:00'),
      endsAt: slot('2026-11-23', '10:10'),
      remaining: 4,
    });
    expect(slots.at(-1)).toEqual({
      startsAt: slot('2026-11-23', '21:50'),
      endsAt: slot('2026-11-23', '22:00'),
      remaining: 4,
    });
  });

  it('respects the minimum lead and the booking horizon and skips closed days', async () => {
    const today = (await availability(context.patient, hemograma, '2026-11-20', '2026-11-22').expect(200))
      .body as ExamAvailability;
    const horizon = (await availability(context.patient, hemograma, '2027-01-18', '2027-01-20').expect(200))
      .body as ExamAvailability;

    expect(today.days.map((day) => day.date)).toEqual(['2026-11-20', '2026-11-21']);
    expect(today.days[0]?.slots[0]?.startsAt).toBe(slot('2026-11-20', '13:00'));
    expect(horizon.days.map((day) => day.date)).toEqual(['2027-01-18', '2027-01-19']);
    expect(horizon.days[1]?.slots.at(-1)?.startsAt).toBe(slot('2027-01-19', '12:00'));
  });

  it('counts the places left by overlap, also when the exam duration changed', async () => {
    const first = await createPatient(context, 'mistura.1@email.com');
    const second = await createPatient(context, 'mistura.2@email.com');
    const long = await booked(first, ultrassom, slot('2026-11-24', '10:00'));

    const { before, after, short } = await withExamDuration(ultrassom, 15, async () => {
      const before = await slotsOn(context.patient, ultrassom, '2026-11-24');
      const short = await booked(second, ultrassom, slot('2026-11-24', '10:15'));
      const after = await slotsOn(context.patient, ultrassom, '2026-11-24');
      return { before, after, short };
    });

    expect(before.slice(0, 3).map(({ startsAt, remaining }) => [startsAt, remaining])).toEqual([
      [slot('2026-11-24', '10:00'), 1],
      [slot('2026-11-24', '10:15'), 1],
      [slot('2026-11-24', '10:30'), 2],
    ]);
    expect(short.endsAt).toBe(slot('2026-11-24', '10:30'));
    expect([await laneOf(long.id), await laneOf(short.id)]).toEqual([1, 2]);
    expect(after.slice(0, 2).map(({ startsAt, remaining }) => [startsAt, remaining])).toEqual([
      [slot('2026-11-24', '10:00'), 1],
      [slot('2026-11-24', '10:30'), 2],
    ]);
  });

  it('answers 404 for an inactive or unknown unit, exam type or offer', async () => {
    const statuses = [
      await withInactive(
        'offer',
        southUltrassom,
        async () => (await availability(context.patient, southUltrassom, '2026-11-23')).status,
      ),
      await withInactive(
        'units',
        southUltrassom,
        async () => (await availability(context.patient, southUltrassom, '2026-11-23')).status,
      ),
      await withInactive(
        'exam_types',
        southUltrassom,
        async () => (await availability(context.patient, southUltrassom, '2026-11-23')).status,
      ),
      (await availability(context.patient, { unitId: UNKNOWN_ID, examTypeId: southUltrassom.examTypeId }, '2026-11-23'))
        .status,
      (await availability(context.patient, { unitId: raioX.unitId, examTypeId: UNKNOWN_ID }, '2026-11-23')).status,
    ];
    const missing = await availability(
      context.patient,
      { unitId: southUltrassom.unitId, examTypeId: raioX.examTypeId },
      '2026-11-23',
    );

    expect(statuses).toEqual([404, 404, 404, 404, 404]);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'NOT_FOUND', message: 'Este exame não está disponível nesta unidade.' });
  });

  it('rejects periods longer than 31 days and missing ids', async () => {
    const tooLong = await availability(context.patient, hemograma, '2026-11-23', '2026-12-24');
    const noUnit = await request(context.app)
      .get('/api/exam-availability')
      .query({ examTypeId: hemograma.examTypeId, from: '2026-11-23', to: '2026-11-23' })
      .set(as(context.patient));

    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { to: 'Consulte no máximo 31 dias por vez.' },
    });
    expect(noUnit.status).toBe(400);
  });
});

describe('POST /api/exam-bookings', () => {
  it('creates a confirmed exam with a public code on the first lane and returns its detail', async () => {
    const response = await book(
      context.patient,
      hemograma,
      slot('2026-11-23', '10:00'),
      '  Levo o pedido\nimpresso.  ',
    );

    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const exam = response.body as ExamBooking;
    expect(exam).toEqual({
      id: expect.any(String) as unknown,
      status: 'confirmed',
      publicCode: expect.stringMatching(PUBLIC_CODE) as unknown,
      startsAt: slot('2026-11-23', '10:00'),
      endsAt: slot('2026-11-23', '10:10'),
      notes: 'Levo o pedido\nimpresso.',
      examType: { id: hemograma.examTypeId, name: 'Hemograma', kind: 'lab', preparationNotes: null },
      unit: centralUnit,
      cancellation: null,
      createdAt: START.toISOString(),
      events: [
        {
          type: 'created',
          actorType: 'patient',
          fromStatus: null,
          toStatus: 'confirmed',
          fromStartsAt: null,
          toStartsAt: null,
          createdAt: START.toISOString(),
        },
      ],
    });
    expect(await laneOf(exam.id)).toBe(1);
    expect((await slotsOn(context.patient, hemograma, '2026-11-23'))[0]).toMatchObject({ remaining: 3 });
  });

  it('fills the next lane of the same slot and answers 409 NO_CAPACITY when it is full', async () => {
    const tokens = await Promise.all(
      ['raia.1', 'raia.2', 'raia.3'].map((name) => createPatient(context, `${name}@email.com`)),
    );
    const startsAt = slot('2026-11-23', '13:00');

    const first = await booked(tokens[0] ?? '', raioX, startsAt);
    const second = await booked(tokens[1] ?? '', raioX, startsAt);
    const third = await book(tokens[2] ?? '', raioX, startsAt);

    expect([await laneOf(first.id), await laneOf(second.id)]).toEqual([1, 2]);
    expect(third.status).toBe(409);
    expect(third.body).toEqual({
      code: 'NO_CAPACITY',
      message: 'Não há mais lugares neste horário. Escolha outra vaga.',
      fields: { startsAt: 'Não há mais lugares neste horário. Escolha outra vaga.' },
    });
    const slots = await slotsOn(context.patient, raioX, '2026-11-23');
    expect(slots.map((item) => item.startsAt)).not.toContain(startsAt);
  });

  it('answers 409 PATIENT_CONFLICT when the patient has an appointment at that time', async () => {
    const patient = await createPatient(context, 'conflito.exame@email.com');
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
    await request(context.app)
      .post('/api/appointments')
      .set(as(patient))
      .send({
        doctorId: carlos.id,
        specialtyId: carlos.specialty.id,
        visitType: 'routine',
        startsAt: slot('2026-11-25', '11:00'),
      })
      .expect(201);

    const response = await book(patient, hemograma, slot('2026-11-25', '11:10'));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'PATIENT_CONFLICT',
      fields: { startsAt: expect.any(String) as unknown },
    });
  });

  it('answers 422 ACTIVE_LIMIT on the sixth active booking, except for the demo patient', async () => {
    const patient = await createPatient(context, 'limite.exame@email.com');
    const times = ['14:00', '14:10', '14:20', '14:30', '14:40', '14:50'];
    for (const time of times.slice(0, 5)) await booked(patient, hemograma, slot('2026-11-26', time));

    const sixth = await book(patient, hemograma, slot('2026-11-26', '14:50'));
    const demo = [];
    for (const time of times) demo.push((await book(context.demoPatient, hemograma, slot('2026-11-27', time))).status);

    expect(sixth.status).toBe(422);
    expect(sixth.body).toMatchObject({ code: 'ACTIVE_LIMIT' });
    expect(demo).toEqual([201, 201, 201, 201, 201, 201]);
  });

  it('answers 422 OUTSIDE_AVAILABILITY for a start that is not a generated slot', async () => {
    const patient = await createPatient(context, 'fora.exame@email.com');
    const starts = [
      slot('2026-11-23', '10:05'),
      slot('2026-11-20', '12:30'),
      slot('2026-11-22', '13:00'),
      slot('2027-01-25', '13:00'),
    ];

    const responses = await Promise.all(starts.map((startsAt) => book(patient, hemograma, startsAt)));

    expect(responses.map((response) => response.status)).toEqual([422, 422, 422, 422]);
    expect(responses[0]?.body).toMatchObject({
      code: 'OUTSIDE_AVAILABILITY',
      fields: { startsAt: 'Este horário não é uma vaga do exame. Escolha uma vaga da lista.' },
    });
  });

  it('answers 404 when the offer, the unit or the exam type is inactive', async () => {
    const patient = await createPatient(context, 'inativo.exame@email.com');
    const startsAt = slot('2026-11-30', '13:00');

    const statuses = [
      await withInactive('offer', southUltrassom, async () => (await book(patient, southUltrassom, startsAt)).status),
      await withInactive('units', southUltrassom, async () => (await book(patient, southUltrassom, startsAt)).status),
      await withInactive(
        'exam_types',
        southUltrassom,
        async () => (await book(patient, southUltrassom, startsAt)).status,
      ),
      (await book(patient, { unitId: southUltrassom.unitId, examTypeId: raioX.examTypeId }, startsAt)).status,
    ];

    expect(statuses).toEqual([404, 404, 404, 404]);
  });

  it('draws a new public code when the drawn one is taken', async () => {
    const patient = await createPatient(context, 'codigo.exame@email.com');
    vi.mocked(newPublicCode)
      .mockReturnValueOnce('EX-C0FFEE')
      .mockReturnValueOnce('EX-C0FFEE')
      .mockReturnValueOnce('EX-BEEF42');

    const first = await booked(patient, hemograma, slot('2026-12-01', '13:00'));
    const second = await booked(patient, hemograma, slot('2026-12-01', '13:10'));

    expect([first.publicCode, second.publicCode]).toEqual(['EX-C0FFEE', 'EX-BEEF42']);
  });

  it('draws codes only from the allowed alphabet', async () => {
    const { newPublicCode: draw } = await vi.importActual<typeof publicCode>(
      '@/modules/exam-bookings/exam-bookings.code.js',
    );

    const codes = Array.from({ length: 500 }, () => draw());

    expect(codes.every((code) => PUBLIC_CODE.test(code))).toBe(true);
    expect(new Set(codes.join('').slice(3)).size).toBeGreaterThan(20);
  });
});

describe('GET /api/exam-bookings/:id', () => {
  it('opens only for the patient of the exam', async () => {
    const owner = await createPatient(context, 'dono.exame@email.com');
    const other = await createPatient(context, 'outro.exame@email.com');
    const exam = await booked(owner, southUltrassom, slot('2026-11-24', '11:00'));
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
    const appointment = await request(context.app)
      .post('/api/appointments')
      .set(as(owner))
      .send({
        doctorId: carlos.id,
        specialtyId: carlos.specialty.id,
        visitType: 'routine',
        startsAt: slot('2026-12-02', '11:00'),
      })
      .expect(201);

    const shown = await show(owner, exam.id);

    expect(shown.status).toBe(200);
    expect(shown.body).toMatchObject({
      id: exam.id,
      examType: { name: 'Ultrassom', kind: 'imaging', preparationNotes: 'Para ultrassom abdominal, jejum de 6 horas.' },
    });
    expect((await show(other, exam.id)).status).toBe(404);
    expect((await show(owner, UNKNOWN_ID)).status).toBe(404);
    expect((await show(owner, (appointment.body as { id: string }).id)).status).toBe(404);
  });
});

describe('POST /api/exam-bookings/:id/cancel', () => {
  it('cancels the exam, frees its place and records the event', async () => {
    const patient = await createPatient(context, 'cancela.exame@email.com');
    const exam = await booked(patient, southUltrassom, slot('2026-11-25', '13:00'));
    expect((await slotsOn(patient, southUltrassom, '2026-11-25')).map((item) => item.startsAt)).not.toContain(
      exam.startsAt,
    );

    const response = await cancel(patient, exam.id, exam.startsAt);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const cancelled = response.body as ExamBooking;
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      cancellation: { byRole: 'patient', reason: null, late: false, cancelledAt: START.toISOString() },
    });
    expect(cancelled.events.map((event) => [event.type, event.toStatus])).toEqual([
      ['created', 'confirmed'],
      ['cancelled', 'cancelled'],
    ]);
    expect((await slotsOn(patient, southUltrassom, '2026-11-25')).map((item) => item.startsAt)).toContain(
      exam.startsAt,
    );
  });

  it('marks a cancellation inside the exam late window as late', async () => {
    const patient = await createPatient(context, 'tardio.exame@email.com');
    const exam = await booked(patient, hemograma, slot('2026-11-20', '13:30'));

    const response = await cancel(patient, exam.id, exam.startsAt);

    expect(response.status).toBe(200);
    expect((response.body as ExamBooking).cancellation).toMatchObject({ late: true });
  });

  it('answers 409 INVALID_STATE for a stale start or an exam already cancelled', async () => {
    const patient = await createPatient(context, 'obsoleto.exame@email.com');
    const exam = await booked(patient, hemograma, slot('2026-11-30', '14:00'));

    const stale = await cancel(patient, exam.id, slot('2026-11-30', '14:10'));
    await cancel(patient, exam.id, exam.startsAt).expect(200);
    const again = await cancel(patient, exam.id, exam.startsAt);

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      code: 'INVALID_STATE',
      message: 'Este exame mudou ou não pode mais ser cancelado. Atualize a página.',
    });
    expect(again.status).toBe(409);
  });

  it('answers 404 to anyone but the patient of the exam', async () => {
    const owner = await createPatient(context, 'dono.cancela@email.com');
    const other = await createPatient(context, 'intruso.cancela@email.com');
    const exam = await booked(owner, hemograma, slot('2026-11-30', '15:00'));

    const response = await cancel(other, exam.id, exam.startsAt);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: 'NOT_FOUND', message: 'Exame não encontrado.' });
    expect(((await show(owner, exam.id).expect(200)).body as ExamBooking).status).toBe('confirmed');
  });
});

describe('exams in the patient list', () => {
  it('let the patient cancel upcoming exams and flag the late window', async () => {
    const patient = await createPatient(context, 'lista.exame@email.com');
    const soon = await booked(patient, hemograma, slot('2026-11-20', '13:40'));
    const later = await booked(patient, hemograma, slot('2026-12-03', '13:00'));

    const page = (
      await request(context.app).get('/api/patient/bookings').query({ kind: 'exam' }).set(as(patient)).expect(200)
    ).body as { items: { id: string; publicCode: string; actions: Record<string, unknown> }[] };

    expect(page.items.map((item) => [item.id, item.publicCode, item.actions])).toEqual([
      [soon.id, soon.publicCode, { canCancel: true, lateCancellation: true, cancelBlockedReason: null }],
      [later.id, later.publicCode, { canCancel: true, lateCancellation: false, cancelBlockedReason: null }],
    ]);
  });
});

describe('exam offer capacity', () => {
  it('refuses lowering the capacity below a lane taken by a future exam', async () => {
    const first = await createPatient(context, 'capacidade.1@email.com');
    const second = await createPatient(context, 'capacidade.2@email.com');
    const startsAt = slot('2026-12-04', '13:00');
    await booked(first, glicemia, startsAt);
    const upper = await booked(second, glicemia, startsAt);
    const save = (capacityPerSlot: number) =>
      request(context.app)
        .put(`/api/admin/units/${glicemia.unitId}/exam-offers/${glicemia.examTypeId}`)
        .set(as(admin))
        .send({ capacityPerSlot });

    const refused = await save(1);
    await cancel(second, upper.id, upper.startsAt).expect(200);
    const lowered = await save(1);
    await save(4).expect(200);

    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      code: 'IN_USE',
      message: 'Há exames futuros marcados acima desta capacidade; ela não pode ser reduzida.',
      fields: { capacityPerSlot: 'Há exames futuros marcados acima desta capacidade; ela não pode ser reduzida.' },
    });
    expect(lowered.status).toBe(200);
  });
});

describe('exam timing', () => {
  it('stops showing a slot once the minimum lead passes', async () => {
    const before = await slotsOn(context.patient, hemograma, '2026-11-20');
    context.clock.advance(HOUR);
    const after = await slotsOn(context.patient, hemograma, '2026-11-20');
    context.clock.advance(-HOUR);

    expect(before[0]?.startsAt).toBe(slot('2026-11-20', '13:00'));
    expect(after[0]?.startsAt).toBe(slot('2026-11-20', '14:00'));
  });
});
