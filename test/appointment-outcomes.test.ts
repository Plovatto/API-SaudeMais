import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  agendaHelpers,
  ids,
  NO_ACTIONS,
  RECORDABLE,
  slot,
  UNKNOWN_ID,
  type AgendaPage,
  type Item,
} from './support/agenda.js';
import { createDoctor, setupClinic, type Clinic, type Doctor } from './support/doctors.js';
import { as, signUp, START } from './support/users.js';

const NOT_RECORDABLE = 'Esta consulta mudou ou já foi registrada. Atualize a página.';
const NOT_STARTED = 'Esta consulta ainda não começou. Conclua ou registre a falta a partir do horário de início.';

let context: Clinic;

beforeAll(async () => {
  context = await setupClinic();
}, 60_000);

const { book, list, confirm, cancel, moveTo } = agendaHelpers(() => context);

describe('POST /api/appointments/:id/complete and /no-show', () => {
  let doctor: string;
  let owner: Doctor;
  let patient: string;
  let other: Awaited<ReturnType<typeof createDoctor>>;

  beforeAll(async () => {
    const created = await createDoctor(context, 'registro.medico@email.com', 'Dra. Registro Teste', '700006');
    doctor = created.token;
    owner = created.doctor;
    patient = await signUp(context.app, 'registrado@email.com');
    other = await createDoctor(context, 'registro.outro@email.com', 'Dr. Registro Outro', '700007');
  });

  const record = (token: string, action: string, id: string, body: Record<string, unknown>) =>
    request(context.app).post(`/api/appointments/${id}/${action}`).set(as(token)).send(body);

  async function started(startsAt: string, at: string): Promise<Item> {
    const booked = await book(patient, owner, startsAt);
    await confirm(doctor, booked.id, { startsAt }).expect(200);
    await moveTo(booked.id, at);
    return { ...booked, startsAt: at };
  }

  const eventsOf = async (id: string) =>
    (
      await context.db.execute<{ event_type: string }>(
        sql`select event_type from booking_events where booking_id = ${id} order by created_at, id`,
      )
    ).rows.map((row) => row.event_type);

  const noticesOf = async (id: string) =>
    (
      await context.db.execute<{ total: number }>(
        sql`select count(*)::int as total from notifications where booking_id = ${id}`,
      )
    ).rows[0]?.total;

  it('completes a started appointment, records the event, notifies nobody and moves it to the history', async () => {
    const awaiting = await started(slot('2026-12-07', '11:00'), slot('2026-11-19', '11:00'));
    const notices = await noticesOf(awaiting.id);
    const shownToDoctor = await request(context.app)
      .get(`/api/appointments/${awaiting.id}`)
      .set(as(doctor))
      .expect(200);
    const before = (await list(doctor, { tab: 'awaiting' }).expect(200)).body as AgendaPage;

    const response = await record(doctor, 'complete', awaiting.id, { startsAt: awaiting.startsAt });

    expect(before.items.find((item) => item.id === awaiting.id)?.actions).toEqual(RECORDABLE);
    expect(shownToDoctor.body).toMatchObject({ patientActions: null, doctorActions: RECORDABLE });
    expect(response.body).toMatchObject({ patientActions: null, doctorActions: NO_ACTIONS });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({ id: awaiting.id, status: 'completed', startsAt: awaiting.startsAt });
    expect((response.body as { events: unknown[] }).events.at(-1)).toEqual({
      type: 'completed',
      actorType: 'doctor',
      fromStatus: 'confirmed',
      toStatus: 'completed',
      fromStartsAt: null,
      toStartsAt: null,
      createdAt: START.toISOString(),
    });
    expect(await noticesOf(awaiting.id)).toBe(notices);
    const after = (await list(doctor, { tab: 'awaiting' }).expect(200)).body as AgendaPage;
    const history = (await list(doctor, { tab: 'history' }).expect(200)).body as AgendaPage;
    expect(ids(after.items)).not.toContain(awaiting.id);
    expect(after.counts.awaiting).toBe(before.counts.awaiting - 1);
    expect(history.items.find((item) => item.id === awaiting.id)).toMatchObject({
      status: 'completed',
      actions: NO_ACTIONS,
    });
    const shown = await request(context.app).get(`/api/appointments/${awaiting.id}`).set(as(patient)).expect(200);
    expect(shown.body).toMatchObject({
      status: 'completed',
      patientActions: { canCancel: false, cancelBlockedReason: 'closed', canReschedule: false },
      doctorActions: null,
    });
  });

  it('records a no-show from the very start of the appointment', async () => {
    const awaiting = await started(slot('2026-12-07', '11:30'), START.toISOString());

    const response = await record(doctor, 'no-show', awaiting.id, { startsAt: awaiting.startsAt });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'no_show' });
    expect((response.body as { events: unknown[] }).events.at(-1)).toMatchObject({
      type: 'no_show',
      actorType: 'doctor',
      fromStatus: 'confirmed',
      toStatus: 'no_show',
    });
    expect(await eventsOf(awaiting.id)).toEqual(['created', 'confirmed', 'no_show']);
  });

  it('answers 409 NOT_STARTED to a confirmed appointment that has not started yet and 404 to other doctors', async () => {
    const booked = await book(patient, owner, slot('2026-12-08', '11:00'));
    await confirm(doctor, booked.id, { startsAt: booked.startsAt }).expect(200);
    const byOtherDoctor = await record(other.token, 'complete', booked.id, { startsAt: booked.startsAt });

    expect(byOtherDoctor.status).toBe(404);
    expect(byOtherDoctor.body).toEqual({ message: 'Consulta não encontrada.', code: 'NOT_FOUND' });

    for (const action of ['complete', 'no-show']) {
      const response = await record(doctor, action, booked.id, { startsAt: booked.startsAt });
      expect(response.status, action).toBe(409);
      expect(response.body).toEqual({ message: NOT_STARTED, code: 'NOT_STARTED', fields: { _root: NOT_STARTED } });
    }
    expect(await eventsOf(booked.id)).toEqual(['created', 'confirmed']);
  });

  it('answers 409 INVALID_STATE for a stale start, a pending, a cancelled or an already recorded appointment', async () => {
    const stale = await started(slot('2026-12-09', '11:00'), slot('2026-11-18', '11:00'));
    const recorded = await started(slot('2026-12-09', '11:30'), slot('2026-11-18', '11:30'));
    await record(doctor, 'complete', recorded.id, { startsAt: recorded.startsAt }).expect(200);
    const pending = await book(patient, owner, slot('2026-12-09', '12:00'));
    const expired = await book(patient, owner, slot('2026-12-09', '12:30'));
    await moveTo(expired.id, slot('2026-11-18', '12:30'));
    const cancelled = await book(patient, owner, slot('2026-12-09', '13:00'));
    await cancel(patient, cancelled.id, cancelled.startsAt);

    const responses = [
      await record(doctor, 'complete', stale.id, { startsAt: slot('2026-12-09', '11:00') }),
      await record(doctor, 'no-show', recorded.id, { startsAt: recorded.startsAt }),
      await record(doctor, 'complete', recorded.id, { startsAt: recorded.startsAt }),
      await record(doctor, 'complete', pending.id, { startsAt: pending.startsAt }),
      await record(doctor, 'no-show', expired.id, { startsAt: slot('2026-11-18', '12:30') }),
      await record(doctor, 'complete', cancelled.id, { startsAt: cancelled.startsAt }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        message: NOT_RECORDABLE,
        code: 'INVALID_STATE',
        fields: { _root: NOT_RECORDABLE },
      });
    }
    expect(await eventsOf(stale.id)).toEqual(['created', 'confirmed']);
    expect(await eventsOf(recorded.id)).toEqual(['created', 'confirmed', 'completed']);
  });

  it('answers 404 to other doctors and to the patient side and 403 to accounts without the doctor profile', async () => {
    const awaiting = await started(slot('2026-12-10', '11:00'), slot('2026-11-17', '11:00'));
    const ownBooking = await book(doctor, other.doctor, slot('2026-12-10', '12:00'));
    await confirm(other.token, ownBooking.id, { startsAt: ownBooking.startsAt }).expect(200);
    await moveTo(ownBooking.id, slot('2026-11-17', '12:00'));
    const body = { startsAt: awaiting.startsAt };

    const otherDoctor = await record(other.token, 'complete', awaiting.id, body);
    const patientSide = await record(doctor, 'no-show', ownBooking.id, { startsAt: slot('2026-11-17', '12:00') });
    const unknown = await record(doctor, 'complete', UNKNOWN_ID, body);
    const byPatient = await record(patient, 'complete', awaiting.id, body);

    for (const response of [otherDoctor, patientSide, unknown]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: 'Consulta não encontrada.', code: 'NOT_FOUND' });
    }
    expect(byPatient.status).toBe(403);
    expect(byPatient.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(await eventsOf(awaiting.id)).toEqual(['created', 'confirmed']);
  });

  it('rejects invalid bodies with 400', async () => {
    const awaiting = await started(slot('2026-12-11', '11:00'), slot('2026-11-16', '11:00'));
    const invalid = [{}, { startsAt: '2026-11-16 11:00' }, { startsAt: awaiting.startsAt, reason: 'x' }];

    for (const body of invalid) {
      const response = await record(doctor, 'complete', awaiting.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});
