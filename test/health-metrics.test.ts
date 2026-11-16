import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DAY } from '@/lib/time.js';
import { DEMO_PATIENT } from '@/modules/users/user.demo.js';
import { agendaHelpers, slot, type Attending } from './support/agenda.js';
import { createDoctor, setupClinic, type Clinic } from './support/doctors.js';
import { as, HOUR, login, signUp, START } from './support/users.js';

let context: Clinic;
let party: Attending;

beforeAll(async () => {
  context = await setupClinic();
  const created = await createDoctor(context, 'medidas.medico@email.com', 'Dra. Medidas Teste', '700020');
  party = {
    patient: await signUp(context.app, 'medidas@email.com'),
    doctor: created.token,
    owner: created.doctor,
  };
}, 60_000);

const { book, confirm, record, started } = agendaHelpers(() => context);

const detail = (token: string, id: string) => request(context.app).get(`/api/appointments/${id}`).set(as(token));
const home = (token: string) => request(context.app).get('/api/patient/home').set(as(token));

const storedMetrics = async (id: string) =>
  (
    await context.db.execute<{ systolic: number | null; diastolic: number | null; weight_kg: string | null }>(
      sql`select systolic, diastolic, weight_kg from health_metrics where booking_id = ${id}`,
    )
  ).rows;

const statusOf = async (id: string) =>
  (await context.db.execute<{ status: string }>(sql`select status from bookings where id = ${id}`)).rows[0]?.status;

describe('POST /api/appointments/:id/complete with metrics', () => {
  it('records pressure and weight with the completion and shows them to both parties', async () => {
    const awaiting = await started(party, slot('2026-12-14', '11:00'), slot('2026-11-19', '11:00'));

    const response = await record(party.doctor, 'complete', awaiting.id, {
      startsAt: awaiting.startsAt,
      metrics: { systolic: 122, diastolic: 81, weightKg: 72.4 },
    });

    const expected = { systolic: 122, diastolic: 81, weightKg: 72.4, recordedAt: START.toISOString() };
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'completed', metrics: expected });
    expect((await detail(party.patient, awaiting.id).expect(200)).body).toMatchObject({ metrics: expected });
    expect((await detail(party.doctor, awaiting.id).expect(200)).body).toMatchObject({ metrics: expected });
    expect(await storedMetrics(awaiting.id)).toEqual([{ systolic: 122, diastolic: 81, weight_kg: '72.40' }]);
  });

  it('records only the pressure or only the weight and leaves the other metric null', async () => {
    const pressure = await started(party, slot('2026-12-14', '11:30'), slot('2026-11-19', '11:30'));
    const weight = await started(party, slot('2026-12-14', '12:00'), slot('2026-11-19', '12:00'));

    const onlyPressure = await record(party.doctor, 'complete', pressure.id, {
      startsAt: pressure.startsAt,
      metrics: { systolic: 110, diastolic: 70 },
    });
    const onlyWeight = await record(party.doctor, 'complete', weight.id, {
      startsAt: weight.startsAt,
      metrics: { weightKg: 80 },
    });

    expect(onlyPressure.body).toMatchObject({ metrics: { systolic: 110, diastolic: 70, weightKg: null } });
    expect(onlyWeight.body).toMatchObject({ metrics: { systolic: null, diastolic: null, weightKg: 80 } });
  });

  it('answers metrics null for appointments completed without metrics or still open', async () => {
    const awaiting = await started(party, slot('2026-12-14', '12:30'), slot('2026-11-19', '12:30'));
    const open = await book(party.patient, party.owner, slot('2026-12-14', '13:00'));

    const completed = await record(party.doctor, 'complete', awaiting.id, { startsAt: awaiting.startsAt });

    expect(completed.body).toMatchObject({ status: 'completed', metrics: null });
    expect((await detail(party.patient, open.id).expect(200)).body).toMatchObject({ metrics: null });
    expect(await storedMetrics(awaiting.id)).toEqual([]);
  });

  it('rejects invalid metrics with 400 and the field path, and changes nothing', async () => {
    const awaiting = await started(party, slot('2026-12-15', '11:00'), slot('2026-11-18', '11:00'));
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{}, { metrics: 'Informe a pressão, o peso ou os dois.' }],
      [{ systolic: 120 }, { 'metrics.diastolic': 'Informe a diastólica junto com a sistólica.' }],
      [{ diastolic: 80 }, { 'metrics.systolic': 'Informe a sistólica junto com a diastólica.' }],
      [{ systolic: 80, diastolic: 80 }, { 'metrics.systolic': 'A sistólica precisa ser maior que a diastólica.' }],
      [{ systolic: 301, diastolic: 80 }, { 'metrics.systolic': 'A sistólica vai de 50 a 300 mmHg.' }],
      [{ systolic: 120, diastolic: 29 }, { 'metrics.diastolic': 'A diastólica vai de 30 a 200 mmHg.' }],
      [{ systolic: 120.5, diastolic: 80 }, { 'metrics.systolic': 'Informe a sistólica em mmHg, sem casas decimais.' }],
      [{ weightKg: 0.5 }, { 'metrics.weightKg': 'O peso vai de 1 a 500 kg.' }],
      [{ weightKg: 500.01 }, { 'metrics.weightKg': 'O peso vai de 1 a 500 kg.' }],
      [{ weightKg: 70.123 }, { 'metrics.weightKg': 'Informe o peso com no máximo duas casas decimais.' }],
      [{ weightKg: '70' }, { 'metrics.weightKg': 'Informe o peso em kg.' }],
    ];

    for (const [metrics, fields] of cases) {
      const response = await record(party.doctor, 'complete', awaiting.id, { startsAt: awaiting.startsAt, metrics });
      expect(response.status, JSON.stringify(metrics)).toBe(400);
      expect(response.body, JSON.stringify(metrics)).toEqual({
        message: 'Dados inválidos.',
        code: 'VALIDATION_ERROR',
        fields,
      });
    }
    const unknownKey = await record(party.doctor, 'complete', awaiting.id, {
      startsAt: awaiting.startsAt,
      metrics: { weightKg: 70, pulse: 72 },
    });
    const onNoShow = await record(party.doctor, 'no-show', awaiting.id, {
      startsAt: awaiting.startsAt,
      metrics: { weightKg: 70 },
    });
    expect([unknownKey.status, onNoShow.status]).toEqual([400, 400]);
    expect(await statusOf(awaiting.id)).toBe('confirmed');
    expect(await storedMetrics(awaiting.id)).toEqual([]);
  });

  it('saves no metrics when the completion is refused with 409', async () => {
    const future = await book(party.patient, party.owner, slot('2026-12-15', '11:30'));
    await confirm(party.doctor, future.id, { startsAt: future.startsAt }).expect(200);
    const recorded = await started(party, slot('2026-12-15', '12:00'), slot('2026-11-18', '12:00'));
    await record(party.doctor, 'no-show', recorded.id, { startsAt: recorded.startsAt }).expect(200);
    const metrics = { systolic: 120, diastolic: 80, weightKg: 70 };

    const notStarted = await record(party.doctor, 'complete', future.id, { startsAt: future.startsAt, metrics });
    const alreadyRecorded = await record(party.doctor, 'complete', recorded.id, {
      startsAt: recorded.startsAt,
      metrics,
    });

    expect(notStarted.status).toBe(409);
    expect(notStarted.body).toMatchObject({ code: 'NOT_STARTED' });
    expect(alreadyRecorded.status).toBe(409);
    expect(alreadyRecorded.body).toMatchObject({ code: 'INVALID_STATE' });
    expect([...(await storedMetrics(future.id)), ...(await storedMetrics(recorded.id))]).toEqual([]);
  });
});

describe('GET /api/patient/home metrics', () => {
  it('shows null cards until a consultation records them, then the latest pressure and weight', async () => {
    const patient = await signUp(context.app, 'cartoes@email.com');
    const attending = { ...party, patient };
    const empty = (await home(patient).expect(200)).body as { metrics: unknown };
    const first = await started(attending, slot('2026-12-16', '11:00'), slot('2026-11-17', '11:00'));
    const second = await started(attending, slot('2026-12-16', '11:30'), slot('2026-11-18', '11:30'));
    const third = await started(attending, slot('2026-12-16', '12:00'), slot('2026-11-19', '12:00'));

    await record(party.doctor, 'complete', first.id, {
      startsAt: first.startsAt,
      metrics: { systolic: 130, diastolic: 85, weightKg: 75.5 },
    }).expect(200);
    context.clock.advance(HOUR);
    await record(party.doctor, 'complete', second.id, {
      startsAt: second.startsAt,
      metrics: { systolic: 118, diastolic: 76 },
    }).expect(200);
    context.clock.advance(HOUR);
    await record(party.doctor, 'complete', third.id, { startsAt: third.startsAt, metrics: { weightKg: 74.25 } }).expect(
      200,
    );

    const response = await home(patient).expect(200);

    expect(empty.metrics).toEqual({ bloodPressure: null, weight: null });
    expect((response.body as { metrics: unknown }).metrics).toEqual({
      bloodPressure: { systolic: 118, diastolic: 76, recordedAt: new Date(START.getTime() + HOUR).toISOString() },
      weight: { kg: 74.25, recordedAt: new Date(START.getTime() + 2 * HOUR).toISOString() },
    });
    expect(((await home(party.patient).expect(200)).body as { metrics: unknown }).metrics).not.toEqual(
      (response.body as { metrics: unknown }).metrics,
    );
  });
});

describe('demo restore with metrics', () => {
  it('seeds metrics for the completed demo appointment and replaces them on the next restore', async () => {
    const demo = await setupClinic();
    const restore = () => demo.modules.maintenance.run({ restoreDemo: true });
    const demoMetrics = async () => {
      const { token } = (
        await login(demo.app, { email: DEMO_PATIENT.email, password: DEMO_PATIENT.password }).expect(200)
      ).body as { token: string };
      return (
        (await request(demo.app).get('/api/patient/home').set(as(token)).expect(200)).body as {
          metrics: { bloodPressure: unknown; weight: unknown };
        }
      ).metrics;
    };
    const total = async () =>
      (await demo.db.execute<{ total: number }>(sql`select count(*)::int as total from health_metrics`)).rows[0]?.total;

    await restore();
    const first = await demoMetrics();
    demo.clock.advance(DAY);
    const second = await restore();

    expect(first).toMatchObject({
      bloodPressure: { systolic: 118, diastolic: 76 },
      weight: { kg: 72.4 },
    });
    expect(second.demoRestored).toMatchObject({ deleted: expect.any(Number) as number });
    expect(await demoMetrics()).toMatchObject({ bloodPressure: { systolic: 118 }, weight: { kg: 72.4 } });
    expect(await total()).toBe(1);
  }, 60_000);
});
