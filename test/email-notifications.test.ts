import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookings, users, type BookingStatus } from '@/database/schema/index.js';
import { lockSeen, moveBooking } from '@/modules/bookings/bookings.repository.js';
import { DEMO_PATIENT } from '@/modules/users/user.demo.js';
import { createDoctor, doctorNamed, setupClinic, type Clinic } from './support/doctors.js';
import { as, createAdmin, createPatient, HOUR, registration, signUp } from './support/users.js';

const MINUTE = 60_000;
const PATIENT_EMAIL = registration().email;
const PATIENT_TOPICS = ['booking_reminder', 'booking_decision', 'exam_result'];

let context: Clinic;

beforeEach(async () => {
  context = await setupClinic();
}, 60_000);

const preferences = (token: string) => request(context.app).get('/api/me/email-preferences').set(as(token));
const choose = (token: string, body: object) =>
  request(context.app).patch('/api/me/email-preferences').set(as(token)).send(body);
const later = (ms: number) => new Date(context.clock.now().getTime() + ms);
const sentTo = (email: string) => context.mailer.sent.filter((message) => message.to === email);

async function userId(email: string): Promise<string> {
  const [row] = await context.db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`${email} does not exist`);
  return row.id;
}

async function appointment(
  email: string,
  status: BookingStatus,
  startsAt: Date,
  doctorName = 'Dr. Carlos Mendes',
): Promise<string> {
  const carlos = await doctorNamed(context, doctorName);
  const [row] = await context.db
    .insert(bookings)
    .values({
      kind: 'appointment',
      patientId: await userId(email),
      unitId: carlos.unit.id,
      doctorId: carlos.id,
      specialtyId: carlos.specialty.id,
      visitType: 'routine',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
      status,
    })
    .returning({ id: bookings.id });
  return row?.id ?? '';
}

async function remindedAt(id: string) {
  const [row] = await context.db.select({ remindedAt: bookings.remindedAt }).from(bookings).where(eq(bookings.id, id));
  return row?.remindedAt ?? null;
}

const runMaintenance = async () => {
  const report = await context.modules.maintenance.run({ restoreDemo: false });
  await context.mail.drain();
  return report;
};

describe('e-mail preferences', () => {
  it('lists the topics of the account roles, all switched on by default', async () => {
    const response = await preferences(context.patient).expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(PATIENT_TOPICS.map((topic) => ({ topic, role: 'patient', enabled: true })));
  });

  it('saves the topics sent and keeps the others', async () => {
    const off = await choose(context.patient, { preferences: [{ topic: 'booking_reminder', enabled: false }] });
    const back = await choose(context.patient, {
      preferences: [
        { topic: 'booking_reminder', enabled: true },
        { topic: 'exam_result', enabled: false },
      ],
    });

    expect(off.status).toBe(200);
    expect(off.body).toContainEqual({ topic: 'booking_reminder', role: 'patient', enabled: false });
    expect(back.body).toEqual([
      { topic: 'booking_reminder', role: 'patient', enabled: true },
      { topic: 'booking_decision', role: 'patient', enabled: true },
      { topic: 'exam_result', role: 'patient', enabled: false },
    ]);
    expect((await preferences(context.patient)).body).toEqual(back.body);
  });

  it('shows the doctor topics to an account that is also a doctor', async () => {
    const { token } = await createDoctor(context, 'helena.email@email.com', 'Dra. Helena Email', '77701');

    const topics = ((await preferences(token).expect(200)).body as { topic: string }[]).map(({ topic }) => topic);

    expect(topics).toEqual([...PATIENT_TOPICS, 'appointment_request', 'appointment_cancellation']);
  });

  it('refuses a topic of a role the account does not have', async () => {
    const response = await choose(context.patient, { preferences: [{ topic: 'user_registration', enabled: false }] });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'TOPIC_NOT_AVAILABLE' });
  });

  it.each([
    ['an empty list', { preferences: [] }],
    ['a repeated topic', { preferences: [{ topic: 'exam_result', enabled: true }, { topic: 'exam_result', enabled: false }] }],
    ['an unknown topic', { preferences: [{ topic: 'newsletter', enabled: false }] }],
    ['extra fields', { preferences: [{ topic: 'exam_result', enabled: false }], all: false }],
  ])('rejects %s', async (_case, body) => {
    expect((await choose(context.patient, body)).status).toBe(400);
  });

  it('lets the demo account change its choices', async () => {
    await preferences(context.demoPatient).expect(200);

    const response = await choose(context.demoPatient, { preferences: [{ topic: 'exam_result', enabled: false }] });

    expect(response.status).toBe(200);
  });
});

describe('notification e-mails', () => {
  it('e-mails the admins that keep the topic on when someone signs up', async () => {
    await createAdmin(context, 'admin.um@email.com');
    const quiet = await createAdmin(context, 'admin.dois@email.com');
    await choose(quiet, { preferences: [{ topic: 'user_registration', enabled: false }] }).expect(200);
    await vi.waitFor(() => expect(sentTo('admin.um@email.com')).toHaveLength(1));

    await signUp(context.app, 'nova.paciente@email.com');

    await vi.waitFor(() => expect(sentTo('admin.um@email.com')).toHaveLength(2));
    const last = sentTo('admin.um@email.com')[1];
    expect(last).toMatchObject({ subject: 'Nova conta no Saúde+ · Saúde+' });
    expect(last?.text).toContain('https://app.saudemais.test/admin/usuarios');
    expect(last?.text).not.toContain('nova.paciente@email.com');
    expect(sentTo('admin.dois@email.com')).toEqual([]);
  });

  it('e-mails the patient when a request expires, unless the patient turned it off', async () => {
    const other = 'bruno.email@email.com';
    const otherToken = await createPatient(context, other);
    await choose(otherToken, { preferences: [{ topic: 'booking_decision', enabled: false }] }).expect(200);
    await appointment(PATIENT_EMAIL, 'pending', later(-MINUTE));
    await appointment(other, 'pending', later(-2 * HOUR));

    await runMaintenance();

    await vi.waitFor(() => expect(sentTo(PATIENT_EMAIL)).toHaveLength(1));
    expect(sentTo(PATIENT_EMAIL)[0]?.subject).toBe('Pedido de consulta não confirmado · Saúde+');
    expect(sentTo(PATIENT_EMAIL)[0]?.html).toContain('<a href="https://app.saudemais.test/paciente/consultas/nova">');
    expect(sentTo(other)).toEqual([]);
  });
});

describe('doctor e-mails', () => {
  it('e-mails the doctor when the patient cancels, unless the doctor turned it off', async () => {
    const { token: doctor } = await createDoctor(context, 'rita.email@email.com', 'Dra. Rita Email', '77702');
    const cancel = async (startsAt: Date) => {
      const id = await appointment(PATIENT_EMAIL, 'confirmed', startsAt, 'Dra. Rita Email');
      await request(context.app)
        .post(`/api/appointments/${id}/cancel`)
        .set(as(context.patient))
        .send({ startsAt: startsAt.toISOString() })
        .expect(200);
    };

    await cancel(later(72 * HOUR));
    await vi.waitFor(() => expect(sentTo('rita.email@email.com')).toHaveLength(1));
    await choose(doctor, { preferences: [{ topic: 'appointment_cancellation', enabled: false }] }).expect(200);
    await cancel(later(96 * HOUR));
    await context.mail.drain();

    const [mail] = sentTo('rita.email@email.com');
    expect(mail?.subject).toBe('Consulta cancelada pelo paciente · Saúde+');
    expect(mail?.text).toContain('https://app.saudemais.test/medico/agenda');
    expect(sentTo('rita.email@email.com')).toHaveLength(1);
  });
});

describe('reminders', () => {
  it('reminds confirmed bookings of the next 24 hours once', async () => {
    const soon = await appointment(PATIENT_EMAIL, 'confirmed', later(23 * HOUR));
    const tomorrowLater = await appointment(PATIENT_EMAIL, 'confirmed', later(25 * HOUR));
    const pending = await appointment(PATIENT_EMAIL, 'pending', later(2 * HOUR));

    const first = await runMaintenance();
    const second = await runMaintenance();

    expect(first.remindersSent).toBe(1);
    expect(second.remindersSent).toBe(0);
    const reminders = sentTo(PATIENT_EMAIL);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.subject).toBe('Lembrete do seu agendamento · Saúde+');
    expect(reminders[0]?.text).toContain('Dr. Carlos Mendes');
    expect(await remindedAt(soon)).toEqual(context.clock.now());
    expect(await remindedAt(tomorrowLater)).toBeNull();
    expect(await remindedAt(pending)).toBeNull();
  });

  it('marks but does not e-mail patients who turned reminders off or the demo account', async () => {
    await choose(context.patient, { preferences: [{ topic: 'booking_reminder', enabled: false }] }).expect(200);
    const quiet = await appointment(PATIENT_EMAIL, 'confirmed', later(3 * HOUR));
    const demo = await appointment(DEMO_PATIENT.email, 'confirmed', later(4 * HOUR));

    expect((await runMaintenance()).remindersSent).toBe(0);

    expect(context.mailer.sent).toEqual([]);
    expect(await remindedAt(quiet)).not.toBeNull();
    expect(await remindedAt(demo)).not.toBeNull();
  });

  it('reminds a booking again after it is moved', async () => {
    const startsAt = later(3 * HOUR);
    const id = await appointment(PATIENT_EMAIL, 'confirmed', startsAt);
    await runMaintenance();
    const patientId = await userId(PATIENT_EMAIL);

    await context.db.transaction(async (tx) => {
      const locked = await lockSeen(tx, patientId, { id, startsAt });
      if (!locked) throw new Error('booking not found');
      await moveBooking(tx, locked, { startsAt: later(5 * HOUR), endsAt: later(5 * HOUR + 30 * MINUTE) }, patientId, startsAt);
    });

    expect(await remindedAt(id)).toBeNull();
    expect((await runMaintenance()).remindersSent).toBe(1);
  });
});
