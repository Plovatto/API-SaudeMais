import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DOCTOR, DEMO_PATIENT } from '@/modules/users/user.demo.js';
import { UNKNOWN_ID } from './support/agenda.js';
import { createDoctor, setupClinic, type Clinic } from './support/doctors.js';
import { insertExam, offerOf, type Offer } from './support/exams.js';
import { createLabKey, ISSUED_AT, publishResult, rowsOf, valueOf, type Exam } from './support/lab.js';
import { as, createAdmin, createPatient, HOUR, login, START } from './support/users.js';

interface Version {
  version: number;
  status: string;
  items: { name: string }[] | null;
  report: string | null;
}

interface Result {
  booking: { id: string; examType: { name: string } };
  current: Version;
  previous: Version[];
}

interface ResultPage {
  items: Result[];
  page: number;
  pageSize: number;
  total: number;
}

interface Review {
  startsAt?: Date;
  status?: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  visitType?: 'routine' | 'exam_review';
}

const DAY = 24 * HOUR;
const AMENDED_AT = '2026-11-20T11:45:00.000Z';
const REPORT = 'Fígado de dimensões normais.';
const ITEMS = [
  { name: 'Hemoglobina', value: 13.8, unit: 'g/dL', referenceRange: '12,0 a 16,0', flag: 'normal' },
  { name: 'Leucócitos', value: 'Ausentes', unit: null, referenceRange: null, flag: 'low' },
];
const AMENDED_ITEMS = [{ ...ITEMS[0], value: 11.2, flag: 'low' }, ITEMS[1]];
const SECRETS = /Hemoglobina|Leucócitos|Ausentes|Fígado|13\.8|11\.2/;

let context: Clinic;
let admin: string;
let patient: string;
let patientId: string;
let stranger: string;
let doctor: { token: string; id: string };
let otherDoctor: { token: string; id: string };
let hemograma: Offer;
let ultrassom: Offer;
let labExam: Exam;
let imagingExam: Exam;
let waitingExam: Exam;

const userId = (email: string) =>
  valueOf<string>(context.db, sql`select id as value from users where email = ${email}`);

async function doctorAccount(email: string, fullName: string, registry: string) {
  const { token, doctor: profile } = await createDoctor(context, email, fullName, registry);
  return { token, id: profile.id };
}

beforeAll(async () => {
  context = await setupClinic();
  admin = await createAdmin(context, 'admin.resultados@email.com');
  const lab = await createLabKey(context.app, admin);
  patient = await createPatient(context, 'paciente.resultados@email.com');
  patientId = await userId('paciente.resultados@email.com');
  stranger = await createPatient(context, 'outro.resultados@email.com');
  doctor = await doctorAccount('helena.prado@email.com', 'Dra. Helena Prado', '55501');
  otherDoctor = await doctorAccount('otavio.reis@email.com', 'Dr. Otávio Reis', '55502');
  hemograma = await offerOf(context, 'Unidade Central', 'hemograma');
  ultrassom = await offerOf(context, 'Unidade Central', 'ultrassom');
  labExam = await insertExam(context, {
    patientId,
    ...hemograma,
    startsAt: new Date('2026-11-18T12:00:00.000Z'),
    status: 'completed',
  });
  imagingExam = await insertExam(context, {
    patientId,
    ...ultrassom,
    startsAt: new Date('2026-11-19T12:00:00.000Z'),
    status: 'completed',
  });
  waitingExam = await insertExam(context, {
    patientId,
    ...hemograma,
    startsAt: new Date('2026-11-19T13:00:00.000Z'),
  });
  const result = (exam: Exam, body: Record<string, unknown>) => ({
    externalId: `LAB-${exam.code}`,
    examCode: exam.code,
    status: 'final',
    issuedAt: ISSUED_AT,
    ...body,
  });
  await publishResult(context.app, lab, result(labExam, { items: ITEMS })).expect(201);
  await publishResult(
    context.app,
    lab,
    result(labExam, { status: 'amended', issuedAt: AMENDED_AT, items: AMENDED_ITEMS }),
  ).expect(200);
  await publishResult(context.app, lab, result(imagingExam, { report: REPORT })).expect(201);
}, 60_000);

const patientRead = (token: string, bookingId: string) =>
  request(context.app).get(`/api/patient/exam-results/${bookingId}`).set(as(token));

const doctorRead = (token: string, id: string, query: Record<string, number> = {}) =>
  request(context.app).get(`/api/doctor/patients/${id}/exam-results`).query(query).set(as(token));

const readAudits = (actorId: string) =>
  rowsOf<{ entity_type: string; metadata: { bookingId: string; version: number } }>(
    context.db,
    sql`select entity_type, metadata from audit_logs where action = 'exam_result.read' and actor_id = ${actorId}
      order by id`,
  );

async function review(
  doctorId: string,
  { startsAt = new Date(START.getTime() - HOUR), status = 'completed', visitType = 'exam_review' }: Review = {},
) {
  const cancelled = status === 'cancelled' ? sql`${START.toISOString()}::timestamptz, 'system'` : sql`null, null`;
  await context.db.execute(sql`
    insert into bookings (kind, patient_id, unit_id, doctor_id, specialty_id, visit_type, starts_at, ends_at, status,
      cancelled_at, cancelled_by_role)
    select 'appointment', ${patientId}, unit_id, user_id, specialty_id, ${visitType}, ${startsAt.toISOString()}::timestamptz,
      ${startsAt.toISOString()}::timestamptz + interval '30 minutes', ${status}, ${cancelled}
    from doctor_profiles where user_id = ${doctorId}
  `);
}

const clearReviews = () =>
  context.db.execute(sql`delete from bookings where kind = 'appointment' and patient_id = ${patientId}`);

describe('patient exam results', () => {
  it('shows the current version and the previous ones and audits the read without values', async () => {
    const response = await patientRead(patient, labExam.id).expect(200);

    expect(response.body).toEqual({
      booking: {
        id: labExam.id,
        publicCode: labExam.code,
        examType: { id: hemograma.examTypeId, name: 'Hemograma', kind: 'lab' },
        unit: expect.objectContaining({ id: hemograma.unitId, name: 'Unidade Central' }) as unknown,
        startsAt: '2026-11-18T12:00:00.000Z',
      },
      current: {
        version: 2,
        status: 'amended',
        issuedAt: AMENDED_AT,
        receivedAt: START.toISOString(),
        items: AMENDED_ITEMS,
        report: null,
      },
      previous: [
        {
          version: 1,
          status: 'final',
          issuedAt: ISSUED_AT,
          receivedAt: START.toISOString(),
          items: ITEMS,
          report: null,
        },
      ],
    });
    expect(response.headers['cache-control']).toBe('no-store');
    const audits = await readAudits(patientId);
    expect(audits).toEqual([{ entity_type: 'exam_result', metadata: { bookingId: labExam.id, version: 2 } }]);
    expect(JSON.stringify(audits)).not.toMatch(SECRETS);
  });

  it('shows the report of an imaging exam', async () => {
    const response = await patientRead(patient, imagingExam.id).expect(200);

    expect(response.body).toMatchObject({
      booking: { examType: { kind: 'imaging' } },
      current: { version: 1, status: 'final', items: null, report: REPORT },
      previous: [],
    });
  });

  it('answers 404 for another patient, an exam without result or an unknown booking, without auditing', async () => {
    const before = (await readAudits(patientId)).length;

    const other = await patientRead(stranger, labExam.id).expect(404);
    expect(other.body).toEqual({ message: 'Resultado não encontrado.', code: 'NOT_FOUND' });
    await patientRead(patient, waitingExam.id).expect(404);
    await patientRead(patient, UNKNOWN_ID).expect(404);
    await patientRead(patient, 'abc').expect(400);

    expect(await readAudits(await userId('outro.resultados@email.com'))).toEqual([]);
    expect(await readAudits(patientId)).toHaveLength(before);
  });

  it('gives the admin no access to result values', async () => {
    const forbidden = await patientRead(admin, labExam.id).expect(403);
    expect(forbidden.body).toMatchObject({ code: 'FORBIDDEN' });
    await doctorRead(admin, patientId).expect(403);
  });

  it('flags the exams that have a result in the list and in the detail', async () => {
    await review(doctor.id);
    const page = await request(context.app).get('/api/patient/bookings').query({ scope: 'past' }).set(as(patient));
    await clearReviews();

    const flags = Object.fromEntries(
      (page.body as { items: { id: string; kind: string; hasResult: boolean }[] }).items.map((item) => [
        item.kind === 'exam' ? item.id : item.kind,
        item.hasResult,
      ]),
    );
    expect(flags).toEqual({ [labExam.id]: true, [imagingExam.id]: true, [waitingExam.id]: false, appointment: false });
    const detail = (id: string) => request(context.app).get(`/api/exam-bookings/${id}`).set(as(patient)).expect(200);
    expect((await detail(labExam.id)).body).toMatchObject({ hasResult: true });
    expect((await detail(waitingExam.id)).body).toMatchObject({ hasResult: false });
  });
});

describe('doctor exam results', () => {
  it('lists the results newest first, with every version, and audits each one without values', async () => {
    await review(doctor.id);
    const before = (await readAudits(doctor.id)).length;

    const response = await doctorRead(doctor.token, patientId).expect(200);
    const small = await doctorRead(doctor.token, patientId, { pageSize: 1, page: 2 }).expect(200);
    await clearReviews();

    const page = response.body as ResultPage;
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(page.items.map((item) => item.booking.id)).toEqual([imagingExam.id, labExam.id]);
    expect(page.items[1]).toMatchObject({
      current: { version: 2, items: AMENDED_ITEMS },
      previous: [{ version: 1, items: ITEMS }],
    });
    expect((small.body as ResultPage).items.map((item) => item.booking.id)).toEqual([labExam.id]);
    const audits = (await readAudits(doctor.id)).slice(before);
    expect(audits.map(({ metadata }) => metadata)).toEqual([
      { bookingId: imagingExam.id, version: 1 },
      { bookingId: labExam.id, version: 2 },
      { bookingId: labExam.id, version: 2 },
    ]);
    expect(JSON.stringify(audits)).not.toMatch(SECRETS);
  });

  it('requires a started exam review, confirmed or completed, within 30 days with this doctor', async () => {
    const cases: [string, Review | undefined, number][] = [
      ['no appointment', undefined, 403],
      ['routine visit', { visitType: 'routine' }, 403],
      ['pending request', { status: 'pending' }, 403],
      ['cancelled review', { status: 'cancelled' }, 403],
      ['missed review', { status: 'no_show' }, 403],
      ['review not started', { status: 'confirmed', startsAt: new Date(START.getTime() + HOUR) }, 403],
      ['review just started', { status: 'confirmed', startsAt: new Date(START.getTime() - 60_000) }, 200],
      ['review 30 days ago', { startsAt: new Date(START.getTime() - 30 * DAY) }, 200],
      ['review over 30 days ago', { startsAt: new Date(START.getTime() - 30 * DAY - 1) }, 403],
    ];

    const outcomes = [];
    for (const [name, link, expected] of cases) {
      if (link) await review(doctor.id, link);
      const response = await doctorRead(doctor.token, patientId);
      await clearReviews();
      outcomes.push([name, response.status, expected === 403 ? (response.body as { code: string }).code : 'OK']);
    }

    expect(outcomes).toEqual(
      cases.map(([name, , expected]) => [name, expected, expected === 403 ? 'FORBIDDEN_NO_LINK' : 'OK']),
    );
  });

  it('refuses another doctor, an unknown patient and accounts without the doctor role', async () => {
    await review(otherDoctor.id);

    const refused = await doctorRead(doctor.token, patientId).expect(403);
    const unknown = await doctorRead(otherDoctor.token, UNKNOWN_ID).expect(403);
    const notDoctor = await doctorRead(patient, patientId).expect(403);
    await clearReviews();

    expect(refused.body).toEqual({
      message:
        'Você só vê os resultados de um paciente com quem tem uma consulta de avaliação de exames confirmada ou concluída nos últimos 30 dias.',
      code: 'FORBIDDEN_NO_LINK',
    });
    expect([unknown.body, notDoctor.body]).toMatchObject([{ code: 'FORBIDDEN_NO_LINK' }, { code: 'FORBIDDEN' }]);
  });
});

const restoreDemo = async () => {
  await context.db.execute(sql`delete from audit_logs where action = 'demo.restored'`);
  return context.modules.demo.service.restore();
};

const demoResults = () =>
  rowsOf<{ version: number }>(
    context.db,
    sql`select v.version from exam_result_versions v join exam_results r on r.id = v.result_id
      join bookings b on b.id = r.booking_id join users u on u.id = b.patient_id where u.is_protected`,
  );

describe('demo exam results', () => {
  it('gives the demo patient a corrected result that the demo doctor can review', async () => {
    await context.modules.demo.service.restore();
    const page = await request(context.app)
      .get('/api/patient/bookings')
      .query({ scope: 'past', kind: 'exam' })
      .set(as(context.demoPatient))
      .expect(200);
    const resulted = (page.body as { items: { id: string; hasResult: boolean }[] }).items.filter(
      (item) => item.hasResult,
    );
    expect(resulted).toHaveLength(1);

    const result = await patientRead(context.demoPatient, resulted[0]?.id ?? '').expect(200);
    const demoDoctor = await login(context.app, { email: DEMO_DOCTOR.email, password: DEMO_DOCTOR.password });
    const reviewed = await doctorRead((demoDoctor.body as { token: string }).token, await userId(DEMO_PATIENT.email));

    expect(result.body).toMatchObject({
      booking: { examType: { name: 'Glicemia' } },
      current: {
        version: 2,
        status: 'amended',
        items: [{ name: 'Glicose em jejum' }, { name: 'Hemoglobina glicada' }],
      },
      previous: [{ version: 1, status: 'final', items: [{ name: 'Glicose em jejum', flag: 'high' }] }],
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body).toMatchObject({ total: 1, items: [{ booking: { id: resulted[0]?.id } }] });
  });

  it('creates the demo integration as the system', async () => {
    const [client] = await rowsOf<{ created_by: string | null; actor_type: string; actor_id: string | null }>(
      context.db,
      sql`select c.created_by, a.actor_type, a.actor_id from integration_clients c
        join audit_logs a on a.entity_id = c.id::text and a.action = 'integration_client.created'
        where c.name = 'Laboratório de demonstração'`,
    );

    expect(client).toEqual({ created_by: null, actor_type: 'system', actor_id: null });
  });

  it('skips the results when the demo integration was revoked or not created by the system', async () => {
    const demoLab = sql`name = 'Laboratório de demonstração'`;
    const adminId = await userId('admin.resultados@email.com');
    await context.db.execute(sql`update integration_clients set revoked_at = now() where ${demoLab}`);
    await expect(restoreDemo()).resolves.toBeDefined();
    expect(await demoResults()).toEqual([]);

    await context.db.execute(
      sql`update integration_clients set revoked_at = null, created_by = ${adminId} where ${demoLab}`,
    );
    await expect(restoreDemo()).resolves.toBeDefined();
    expect(await demoResults()).toEqual([]);

    await context.db.execute(sql`update integration_clients set created_by = null where ${demoLab}`);
  });

  it('still restores the demo bookings when publishing a result fails', async () => {
    await context.db.execute(sql`update exam_types set kind = 'imaging' where code = 'glicemia'`);
    const restored = await restoreDemo();
    await context.db.execute(sql`update exam_types set kind = 'lab' where code = 'glicemia'`);

    expect(restored).toMatchObject({ created: expect.any(Number) as unknown });
    expect(await demoResults()).toEqual([]);
    await restoreDemo();
    expect((await demoResults()).map(({ version }) => version).sort()).toEqual([1, 2]);
  });
});
