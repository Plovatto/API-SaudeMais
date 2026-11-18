import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import {
  agendaHelpers,
  ids,
  NO_ACTIONS,
  RECORDABLE,
  slot,
  UNKNOWN_ID,
  type AgendaPage,
  type Counts,
  type Item,
} from './support/agenda.js';
import { createDoctor, doctorNamed, setupClinic, type Clinic, type Doctor } from './support/doctors.js';
import { as, login, signUp, START } from './support/users.js';

interface Home {
  today: Record<string, unknown>;
  pending: Item[];
  awaitingRecord: Item[];
  counts: Counts;
  lastNotification: { type: string; bookingId: string } | null;
}

const NOT_CONFIRMABLE = 'Esta consulta mudou ou não pode mais ser confirmada. Atualize a página.';

let context: Clinic;
let historian: string;
let helper: string;
let idleDoctor: string;

beforeAll(async () => {
  context = await setupClinic();
  historian = await signUp(context.app, 'historico@email.com');
  helper = await signUp(context.app, 'apoio@email.com');
}, 60_000);

const { book, list, confirm, cancel, moveTo } = agendaHelpers(() => context);

const home = (token: string) => request(context.app).get('/api/doctor/home').set(as(token));

const setStatus = (id: string, status: string) =>
  context.db.execute(sql`update bookings set status = ${status} where id = ${id}`);

describe('doctor agenda routes', () => {
  it('require a session and the doctor role', async () => {
    for (const path of ['/api/doctor/appointments', '/api/doctor/home']) {
      expect((await request(context.app).get(path)).status, path).toBe(401);
      const forbidden = await request(context.app).get(path).set(as(context.patient));
      expect(forbidden.status, path).toBe(403);
      expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});

describe('GET /api/doctor/appointments', () => {
  let doctor: string;
  let patientId: string;
  let pendingSoon: Item;
  let pendingLater: Item;
  let confirmedSoon: Item;
  let confirmedLater: Item;
  let expired: Item;
  let awaiting: Item;
  let cancelled: Item;
  let completed: Item;

  beforeAll(async () => {
    const created = await createDoctor(context, 'agenda.medico@email.com', 'Dra. Agenda Teste', '700001');
    doctor = created.token;
    const owner = created.doctor;
    const token = context.patient;
    const other = historian;
    const rows = await context.db.execute<{ id: string }>(
      sql`select id from users where email = 'ana.silva@email.com'`,
    );
    patientId = rows.rows[0]?.id ?? '';

    pendingLater = await book(token, owner, slot('2026-11-24', '11:00'));
    pendingSoon = await book(token, owner, slot('2026-11-23', '11:30'), 'Dor de cabeça.');
    confirmedSoon = await book(token, owner, slot('2026-11-23', '12:00'));
    confirmedLater = await book(token, owner, slot('2026-11-25', '11:00'));
    await setStatus(confirmedSoon.id, 'confirmed');
    await setStatus(confirmedLater.id, 'confirmed');

    expired = await book(other, owner, slot('2026-11-26', '11:00'));
    await moveTo(expired.id, slot('2026-11-16', '11:00'));
    awaiting = await book(other, owner, slot('2026-11-26', '11:30'));
    await setStatus(awaiting.id, 'confirmed');
    await moveTo(awaiting.id, slot('2026-11-16', '11:30'));
    completed = await book(other, owner, slot('2026-11-27', '11:30'));
    await setStatus(completed.id, 'completed');
    await moveTo(completed.id, slot('2026-11-17', '11:30'));
    cancelled = await book(other, owner, slot('2026-11-27', '11:00'));
    await cancel(other, cancelled.id, cancelled.startsAt);
  });

  it('lists pending requests soonest first with the patient, the allowed actions and the tab counts', async () => {
    const response = await list(doctor);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const page = response.body as AgendaPage;
    expect(page).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
      counts: { pending: 2, confirmed: 2, awaiting: 1, history: 4 },
    });
    expect(ids(page.items)).toEqual([pendingSoon.id, pendingLater.id]);
    const owner = await doctorNamed(context, 'Dra. Agenda Teste');
    expect(page.items[0]).toEqual({
      id: pendingSoon.id,
      status: 'pending',
      visitType: 'routine',
      startsAt: '2026-11-23T11:30:00.000Z',
      endsAt: '2026-11-23T12:00:00.000Z',
      notes: 'Dor de cabeça.',
      patient: { id: patientId, fullName: 'Ana Maria Silva', phone: '+5511987654321' },
      specialty: owner.specialty,
      unit: owner.unit,
      cancellation: null,
      actions: { canConfirm: true, canCancel: true, canComplete: false, canNoShow: false },
    });
  });

  it('lists confirmed appointments soonest first, cancellable but not confirmable', async () => {
    const page = (await list(doctor, { tab: 'confirmed' }).expect(200)).body as AgendaPage;

    expect(ids(page.items)).toEqual([confirmedSoon.id, confirmedLater.id]);
    for (const item of page.items) {
      expect(item).toMatchObject({ status: 'confirmed', actions: { ...NO_ACTIONS, canCancel: true } });
    }
  });

  it('lists the history most recent first, including started confirmed appointments awaiting record', async () => {
    const page = (await list(doctor, { tab: 'history' }).expect(200)).body as AgendaPage;

    expect(page.items.map((item) => [item.id, item.status])).toEqual([
      [cancelled.id, 'cancelled'],
      [completed.id, 'completed'],
      [awaiting.id, 'confirmed'],
      [expired.id, 'expired'],
    ]);
    expect(page.items[0]?.cancellation).toEqual({
      byRole: 'patient',
      reason: null,
      late: false,
      cancelledAt: START.toISOString(),
    });
    for (const item of page.items) expect(item.actions).toEqual(item.id === awaiting.id ? RECORDABLE : NO_ACTIONS);
  });

  it('lists started confirmed appointments awaiting record oldest first', async () => {
    const page = (await list(doctor, { tab: 'awaiting' }).expect(200)).body as AgendaPage;

    expect(page).toMatchObject({ total: 1, counts: { awaiting: 1, history: 4 } });
    expect(page.items[0]).toMatchObject({ id: awaiting.id, status: 'confirmed', actions: RECORDABLE });
  });

  it('shows the phone only while the patient may still need to be reached or was seen', async () => {
    const page = (await list(doctor, { tab: 'history' }).expect(200)).body as AgendaPage;

    const phones = Object.fromEntries(
      page.items.map((item) => [item.status, (item.patient as { phone: string | null }).phone]),
    );
    expect(phones).toEqual({
      cancelled: null,
      completed: '+5511987654321',
      confirmed: '+5511987654321',
      expired: null,
    });
  });

  it('starts at the São Paulo day given in from without changing the counts', async () => {
    const pending = (await list(doctor, { from: '2026-11-24' }).expect(200)).body as AgendaPage;
    const history = (await list(doctor, { tab: 'history', from: '2026-11-17' }).expect(200)).body as AgendaPage;
    await moveTo(pendingLater.id, '2026-11-24T02:30:00.000Z');
    const beforeMidnight = (await list(doctor, { from: '2026-11-24' }).expect(200)).body as AgendaPage;
    await moveTo(pendingLater.id, '2026-11-24T03:00:00.000Z');
    const atMidnight = (await list(doctor, { from: '2026-11-24' }).expect(200)).body as AgendaPage;
    await moveTo(pendingLater.id, slot('2026-11-24', '11:00'));

    expect(ids(pending.items)).toEqual([pendingLater.id]);
    expect(pending.counts).toEqual({ pending: 2, confirmed: 2, awaiting: 1, history: 4 });
    expect(ids(history.items)).toEqual([cancelled.id, completed.id]);
    expect(beforeMidnight.items).toEqual([]);
    expect(ids(atMidnight.items)).toEqual([pendingLater.id]);
  });

  it('paginates', async () => {
    const page = (await list(doctor, { tab: 'history', pageSize: 1, page: 2 }).expect(200)).body as AgendaPage;

    expect(page).toMatchObject({ page: 2, pageSize: 1, total: 4 });
    expect(ids(page.items)).toEqual([completed.id]);
  });

  it('shows only the appointments of the logged doctor', async () => {
    idleDoctor = (await createDoctor(context, 'outro.medico@email.com', 'Dr. Outro Teste', '700002')).token;

    const page = (await list(idleDoctor, { tab: 'history' }).expect(200)).body as AgendaPage;

    expect(page).toMatchObject({ total: 0, items: [], counts: { pending: 0, confirmed: 0, history: 0 } });
  });

  it('rejects invalid filters with 400', async () => {
    const invalid = [
      { tab: 'todas' },
      { from: '2026-13-01' },
      { from: '24/11/2026' },
      { to: '2026-11-31' },
      { search: 'a'.repeat(121) },
      { pageSize: 51 },
      { extra: 1 },
    ];
    for (const query of invalid) {
      const response = await list(doctor, query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

describe('GET /api/doctor/appointments filters', () => {
  let doctor: string;
  let counts: Counts;
  let past: Item;
  let joaoSoon: Item;
  let confirmed: Item;
  let cancelled: Item;
  let joaoLater: Item;

  beforeAll(async () => {
    const created = await createDoctor(context, 'filtros.medico@email.com', 'Dra. Filtros Teste', '700004');
    doctor = created.token;
    const owner = created.doctor;
    const joao = await signUp(context.app, 'joao.filtros@email.com', 'João Conceição');

    past = await book(helper, owner, slot('2026-11-26', '11:00'));
    await setStatus(past.id, 'completed');
    await moveTo(past.id, slot('2026-11-16', '11:00'));
    joaoSoon = await book(joao, owner, slot('2026-11-23', '11:00'));
    confirmed = await book(helper, owner, slot('2026-11-23', '12:00'));
    await setStatus(confirmed.id, 'confirmed');
    cancelled = await book(joao, owner, slot('2026-11-25', '11:00'));
    await cancel(joao, cancelled.id, cancelled.startsAt);
    joaoLater = await book(joao, owner, slot('2026-11-27', '11:00'));
    counts = ((await list(doctor).expect(200)).body as AgendaPage).counts;
  });

  const agenda = async (query: Record<string, string>) => (await list(doctor, query).expect(200)).body as AgendaPage;
  const listed = async (query: Record<string, string>) => ids((await agenda(query)).items);

  it('lists every appointment in any status oldest first in the all tab, with the same counts', async () => {
    const page = await agenda({ tab: 'all' });

    expect(page.items.map((item) => [item.id, item.status])).toEqual([
      [past.id, 'completed'],
      [joaoSoon.id, 'pending'],
      [confirmed.id, 'confirmed'],
      [cancelled.id, 'cancelled'],
      [joaoLater.id, 'pending'],
    ]);
    expect(page.total).toBe(5);
    expect(counts).toEqual({
      pending: 2,
      confirmed: 1,
      awaiting: 0,
      history: 2,
    });
    expect(page.counts).toEqual(counts);
  });

  it('keeps the São Paulo days between from and to, both included', async () => {
    expect(await listed({ tab: 'all', from: '2026-11-23', to: '2026-11-25' })).toEqual([
      joaoSoon.id,
      confirmed.id,
      cancelled.id,
    ]);
    expect(await listed({ tab: 'all', from: '2026-11-23', to: '2026-11-23' })).toEqual([joaoSoon.id, confirmed.id]);
    expect(await listed({ tab: 'all', to: '2026-11-23' })).toEqual([past.id, joaoSoon.id, confirmed.id]);
    expect(await listed({ to: '2026-11-26' })).toEqual([joaoSoon.id]);

    await moveTo(cancelled.id, '2026-11-26T02:30:00.000Z');
    const beforeMidnight = await listed({ tab: 'all', to: '2026-11-25' });
    await moveTo(cancelled.id, '2026-11-26T03:00:00.000Z');
    const atMidnight = await listed({ tab: 'all', to: '2026-11-25' });
    await moveTo(cancelled.id, slot('2026-11-25', '11:00'));

    expect(beforeMidnight).toContain(cancelled.id);
    expect(atMidnight).not.toContain(cancelled.id);
  });

  it('searches the patient name ignoring accents, case and surrounding spaces, without changing the counts', async () => {
    const joaos = [joaoSoon.id, cancelled.id, joaoLater.id];
    for (const search of ['joao', 'JOÃO', '  conceicao  ', 'joão conceição']) {
      const page = await agenda({ tab: 'all', search });
      expect(ids(page.items), search).toEqual(joaos);
      expect(page.total).toBe(3);
      expect(page.counts).toEqual(counts);
    }
    for (const search of ['%', '_', '\\']) {
      expect(await listed({ tab: 'all', search }), search).toEqual([]);
    }
    expect(await listed({ tab: 'all', search: 'Maria' })).toEqual([]);
    expect((await agenda({ tab: 'all', search: '   ' })).total).toBe(5);
  });

  it('pages the all tab in the same order', async () => {
    const second = await agenda({ tab: 'all', page: '2', pageSize: '2' });

    expect(second).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(ids(second.items)).toEqual([confirmed.id, cancelled.id]);
  });

  it('combines the tab, the period and the search', async () => {
    expect(await listed({ search: 'joao', from: '2026-11-23', to: '2026-11-25' })).toEqual([joaoSoon.id]);
    expect(await listed({ tab: 'history', search: 'joao' })).toEqual([cancelled.id]);
    expect(await listed({ tab: 'all', search: 'paciente', from: '2026-11-17' })).toEqual([confirmed.id]);
  });

  it('rejects a to before from with 400', async () => {
    const response = await list(doctor, {
      tab: 'all',
      from: '2026-11-25',
      to: '2026-11-24',
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { to: 'A data final precisa ser igual ou posterior à inicial.' },
    });
  });
});

describe('GET /api/doctor/home', () => {
  it('summarizes the São Paulo day, the next three requests, the counts and the latest notice', async () => {
    const { token: doctor, doctor: owner } = await createDoctor(
      context,
      'inicio.medico@email.com',
      'Dr. Inicio Teste',
      '700003',
    );
    const [first, second] = [historian, helper];
    const today = (time: string) => slot('2026-11-20', time);

    const pendingToday = await book(first, owner, today('13:30'));
    const confirmedToday = await book(first, owner, today('14:00'));
    await setStatus(confirmedToday.id, 'confirmed');
    const awaiting = await book(first, owner, today('14:30'));
    await setStatus(awaiting.id, 'confirmed');
    await moveTo(awaiting.id, today('10:00'));
    const expired = await book(first, owner, today('16:00'));
    await moveTo(expired.id, today('10:30'));
    const completed = await book(first, owner, today('16:30'));
    await setStatus(completed.id, 'completed');
    await moveTo(completed.id, today('11:00'));
    const noShow = await book(second, owner, today('17:00'));
    await setStatus(noShow.id, 'no_show');
    await moveTo(noShow.id, today('11:30'));
    const lateToday = await book(second, owner, today('17:30'));
    await moveTo(lateToday.id, '2026-11-21T02:30:00.000Z');
    const tomorrow = await book(second, owner, today('18:00'));
    await moveTo(tomorrow.id, '2026-11-21T03:00:00.000Z');
    const yesterday = await book(second, owner, today('18:30'));
    await moveTo(yesterday.id, '2026-11-20T02:30:00.000Z');
    await book(first, owner, slot('2026-11-23', '11:00'));
    const cancelled = await book(first, owner, today('19:00'));
    await cancel(first, cancelled.id, cancelled.startsAt);

    const response = await home(doctor);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.body as Home;
    expect(body.today).toEqual({
      date: '2026-11-20',
      total: 8,
      pending: 2,
      confirmed: 1,
      awaitingRecord: 1,
      completed: 1,
      noShow: 1,
      cancelled: 1,
      expired: 1,
    });
    expect(ids(body.pending)).toEqual([pendingToday.id, lateToday.id, tomorrow.id]);
    expect(body.pending[0]?.actions).toEqual({ ...NO_ACTIONS, canConfirm: true, canCancel: true });
    expect(ids(body.awaitingRecord)).toEqual([awaiting.id]);
    expect(body.awaitingRecord[0]?.actions).toEqual(RECORDABLE);
    expect(body.counts).toEqual({ pending: 4, confirmed: 1, awaiting: 1, history: 6 });
    expect(body.lastNotification).toMatchObject({ type: 'appointment_cancelled_by_patient', bookingId: cancelled.id });
  });

  it('starts empty for a doctor without appointments', async () => {
    const body = (await home(idleDoctor).expect(200)).body as Home;

    expect(body).toEqual({
      today: {
        date: '2026-11-20',
        total: 0,
        pending: 0,
        confirmed: 0,
        awaitingRecord: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
        expired: 0,
      },
      pending: [],
      awaitingRecord: [],
      counts: { pending: 0, confirmed: 0, awaiting: 0, history: 0 },
      lastNotification: null,
    });
  });
});

describe('POST /api/appointments/:id/confirm', () => {
  let doctor: string;
  let owner: Doctor;
  let patient: string;

  beforeAll(async () => {
    const created = await createDoctor(context, 'confirma.medico@email.com', 'Dra. Confirma Teste', '700005');
    doctor = created.token;
    owner = created.doctor;
    patient = await signUp(context.app, 'confirmado@email.com');
  });

  const unread = async (token: string) =>
    (
      (await request(context.app).get('/api/notifications/unread-count?role=patient').set(as(token)).expect(200))
        .body as { count: number }
    ).count;

  it('confirms a pending request, records the event and notifies the patient', async () => {
    const booked = await book(patient, owner, slot('2026-12-01', '11:00'));
    const before = await unread(patient);

    const response = await confirm(doctor, booked.id, { startsAt: booked.startsAt });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ id: booked.id, status: 'confirmed', startsAt: booked.startsAt });
    expect((response.body as { events: unknown[] }).events.at(-1)).toEqual({
      type: 'confirmed',
      actorType: 'doctor',
      fromStatus: 'pending',
      toStatus: 'confirmed',
      fromStartsAt: null,
      toStartsAt: null,
      createdAt: START.toISOString(),
    });
    const rows = await context.db.execute(sql`
      select n.user_id = b.patient_id as to_patient, n.audience_role, n.type, n.params
      from notifications n join bookings b on b.id = n.booking_id
      where n.booking_id = ${booked.id} and n.type = 'appointment_confirmed'
    `);
    expect(rows.rows).toEqual([
      {
        to_patient: true,
        audience_role: 'patient',
        type: 'appointment_confirmed',
        params: { startsAt: booked.startsAt },
      },
    ]);
    expect(before).toBe(0);
    expect(await unread(patient)).toBe(1);
    const agenda = (await list(doctor, { tab: 'confirmed' }).expect(200)).body as AgendaPage;
    expect(ids(agenda.items)).toContain(booked.id);
  });

  it('answers 409 INVALID_STATE for a stale start, an already confirmed, a cancelled or a past request', async () => {
    const stale = await book(patient, owner, slot('2026-12-02', '11:00'));
    const twice = await book(patient, owner, slot('2026-12-02', '11:30'));
    const cancelled = await book(patient, owner, slot('2026-12-02', '12:00'));
    const past = await book(patient, owner, slot('2026-12-02', '12:30'));
    await confirm(doctor, twice.id, { startsAt: twice.startsAt }).expect(200);
    await cancel(patient, cancelled.id, cancelled.startsAt);
    await moveTo(past.id, slot('2026-11-20', '11:30'));

    const responses = [
      await confirm(doctor, stale.id, { startsAt: slot('2026-12-02', '13:00') }),
      await confirm(doctor, twice.id, { startsAt: twice.startsAt }),
      await confirm(doctor, cancelled.id, { startsAt: cancelled.startsAt }),
      await confirm(doctor, past.id, { startsAt: slot('2026-11-20', '11:30') }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: NOT_CONFIRMABLE,
        code: 'INVALID_STATE',
        fields: { _root: NOT_CONFIRMABLE },
      });
    }
    const statuses = await context.db.execute<{ id: string; status: string }>(
      sql`select id, status from bookings where id in (${stale.id}, ${past.id})`,
    );
    expect(statuses.rows.map((row) => row.status)).toEqual(['pending', 'pending']);
    const events = await context.db.execute<{ total: number }>(
      sql`select count(*)::int as total from booking_events where booking_id = ${twice.id} and event_type = 'confirmed'`,
    );
    expect(events.rows[0]?.total).toBe(1);
  });

  it('answers 404 to other doctors, exams and unknown ids and 403 to accounts without the doctor profile', async () => {
    const booked = await book(patient, owner, slot('2026-12-03', '11:00'));
    const other = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password }).expect(200);
    const body = { startsAt: booked.startsAt };

    const otherDoctor = await confirm((other.body as { token: string }).token, booked.id, body);
    const unknown = await confirm(doctor, UNKNOWN_ID, body);
    const byPatient = await confirm(patient, booked.id, body);
    const exams = await context.db.execute<{ id: string }>(sql`
      insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
      select 'exam', u.id, o.unit_id, o.exam_type_id, 'EX-9H5N4S', 1, '2026-12-10T12:00:00Z', '2026-12-10T12:20:00Z', 'confirmed'
      from users u, (select unit_id, exam_type_id from unit_exam_offers limit 1) o
      where u.email = 'historico@email.com'
      returning id
    `);
    const exam = await confirm(doctor, exams.rows[0]?.id ?? '', { startsAt: '2026-12-10T12:00:00.000Z' });

    expect(otherDoctor.status).toBe(404);
    expect(otherDoctor.body).toEqual({ message: 'Consulta não encontrada.', code: 'NOT_FOUND' });
    expect(unknown.status).toBe(404);
    expect(exam.status).toBe(404);
    expect(byPatient.status).toBe(403);
    expect(byPatient.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets the demo doctor confirm requests of protected patients', async () => {
    const demoDoctor = await doctorNamed(context, DEMO_DOCTOR.fullName);
    const token = (
      (await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password }).expect(200)).body as {
        token: string;
      }
    ).token;
    const booked = await book(context.demoPatient, demoDoctor, slot('2026-12-04', '11:00'));

    const response = await confirm(token, booked.id, { startsAt: booked.startsAt });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'confirmed' });
  });

  it('rejects invalid bodies with 400', async () => {
    const booked = await book(patient, owner, slot('2026-12-03', '12:00'));
    const invalid = [{}, { startsAt: '2026-12-03 12:00' }, { startsAt: booked.startsAt, reason: 'x' }];

    for (const body of invalid) {
      const response = await confirm(doctor, booked.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect((await confirm(doctor, 'abc', { startsAt: booked.startsAt })).status).toBe(400);
  });
});
