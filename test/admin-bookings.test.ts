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
import { as, login, signUp } from './support/users.js';

const ADMIN = { email: 'admin@saudemais.test', password: 'admin-segura-123' };

let context: Clinic;
let admin: string;

beforeAll(async () => {
  context = await setupClinic();
  await context.modules.users.bootstrap(ADMIN);
  admin = ((await login(context.app, ADMIN).expect(200)).body as { token: string }).token;
}, 60_000);

async function patient(email: string) {
  const token = await signUp(context.app, email);
  const id = ((await request(context.app).get('/api/me').set(as(token)).expect(200)).body as { id: string }).id;
  return { token, id };
}

async function book(token: string, doctor: Doctor, startsAt: string) {
  const response = await request(context.app)
    .post('/api/appointments')
    .set(as(token))
    .send({ doctorId: doctor.id, specialtyId: doctor.specialty.id, visitType: 'routine', startsAt })
    .expect(201);
  return (response.body as { id: string }).id;
}

const adminCall = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: object) => {
  const pending = request(context.app)[method](path).set(as(admin));
  return body ? pending.send(body) : pending;
};

async function bookingRow(id: string) {
  const result = await context.db.execute<{
    status: string;
    cancelled_by_role: string;
    cancelled_by: string;
    cancelled_at: string;
  }>(sql`select status, cancelled_by_role, cancelled_by, cancelled_at from bookings where id = ${id}`);
  return result.rows[0];
}

async function eventsOf(id: string) {
  const result = await context.db.execute<{ event_type: string; actor_type: string; from_status: string }>(
    sql`select event_type, actor_type, from_status from booking_events where booking_id = ${id} order by created_at, id`,
  );
  return result.rows;
}

async function noticesOf(id: string) {
  const result = await context.db.execute<{ user_id: string; audience_role: string; type: string; params: unknown }>(
    sql`select user_id, audience_role, type, params from notifications where booking_id = ${id} and type = 'appointment_cancelled'`,
  );
  return result.rows;
}

const adminId = async () =>
  ((await request(context.app).get('/api/me').set(as(admin)).expect(200)).body as { id: string }).id;

describe('deactivation impact', () => {
  it('counts the active future bookings as patient and as doctor', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
    const ana = await doctorNamed(context, 'Dra. Ana Ferreira');
    const counted = await patient('impacto@email.com');
    await book(counted.token, carlos, '2026-11-23T11:00:00.000Z');
    await book(counted.token, ana, '2026-11-24T11:00:00.000Z');

    const asPatient = await adminCall('get', `/api/admin/users/${counted.id}/deactivation-impact`).expect(200);
    const asDoctor = await adminCall('get', `/api/admin/users/${carlos.id}/deactivation-impact`).expect(200);

    expect(asPatient.body).toEqual({ futureAppointmentsAsPatient: 2, futureAppointmentsAsDoctor: 0 });
    expect(asDoctor.body).toEqual({ futureAppointmentsAsPatient: 0, futureAppointmentsAsDoctor: 1 });
  });
});

describe('cancelling on deactivation', () => {
  it('cancels the bookings of a deactivated patient, notifies the doctor and frees the slot', async () => {
    const carlos = await doctorNamed(context, 'Dr. Carlos Mendes');
    const leaving = await patient('saindo@email.com');
    const id = await book(leaving.token, carlos, '2026-11-25T11:00:00.000Z');

    await adminCall('post', `/api/admin/users/${leaving.id}/deactivate`).expect(200);

    expect(await bookingRow(id)).toMatchObject({
      status: 'cancelled',
      cancelled_by_role: 'admin',
      cancelled_by: await adminId(),
    });
    expect(await eventsOf(id)).toEqual([
      { event_type: 'created', actor_type: 'patient', from_status: null },
      { event_type: 'cancelled', actor_type: 'admin', from_status: 'pending' },
    ]);
    expect(await noticesOf(id)).toEqual([
      {
        user_id: carlos.id,
        audience_role: 'doctor',
        type: 'appointment_cancelled',
        params: { startsAt: '2026-11-25T11:00:00.000Z', cancelledByRole: 'admin' },
      },
    ]);
    const days = (
      (await availability(context, context.patient, carlos.id, { from: '2026-11-25', to: '2026-11-25' }).expect(200))
        .body as Availability
    ).days;
    expect(days[0]?.slots[0]?.startsAt).toBe('2026-11-25T11:00:00.000Z');
  });

  it('cancels the appointments of a deactivated doctor and notifies the patients', async () => {
    const beatriz = await doctorNamed(context, 'Dra. Beatriz Lima');
    const staying = await patient('fica@email.com');
    const id = await book(staying.token, beatriz, '2026-11-23T11:00:00.000Z');
    const unread = () =>
      request(context.app).get('/api/notifications/unread-count?role=patient').set(as(staying.token)).expect(200);
    const before = ((await unread()).body as { count: number }).count;

    await adminCall('post', `/api/admin/users/${beatriz.id}/deactivate`).expect(200);

    expect(await bookingRow(id)).toMatchObject({ status: 'cancelled', cancelled_by_role: 'admin' });
    expect(await noticesOf(id)).toEqual([expect.objectContaining({ user_id: staying.id, audience_role: 'patient' })]);
    expect(((await unread()).body as { count: number }).count).toBe(before + 1);
  });

  it('cancels the appointments of a doctor whose profile is removed', async () => {
    const rafael = await doctorNamed(context, 'Dr. Rafael Costa');
    const booked = await patient('perfil@email.com');
    const id = await book(booked.token, rafael, '2026-11-24T11:00:00.000Z');

    await adminCall('delete', `/api/admin/users/${rafael.id}/doctor-profile`).expect(200);

    expect(await bookingRow(id)).toMatchObject({ status: 'cancelled', cancelled_by_role: 'admin' });
    expect(await noticesOf(id)).toEqual([expect.objectContaining({ user_id: booked.id, audience_role: 'patient' })]);
  });
});

describe('changes blocked by future bookings', () => {
  it('refuses to move a doctor with future appointments to another unit (RN-08)', async () => {
    const ana = await doctorNamed(context, 'Dra. Ana Ferreira');
    const units = (await request(context.app).get('/api/units').set(as(admin)).expect(200)).body as {
      id: string;
      name: string;
    }[];
    const south = units.find((unit) => unit.name === 'Unidade Sul');

    const response = await adminCall('patch', `/api/admin/users/${ana.id}/doctor-profile`, { unitId: south?.id });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'HAS_FUTURE_APPOINTMENTS' });
  });

  it('refuses to deactivate catalog entries with active future bookings (RN-20)', async () => {
    const ana = await doctorNamed(context, 'Dra. Ana Ferreira');
    const examPatient = await patient('exame@email.com');
    const offer = await context.db.execute<{ unit_id: string; exam_type_id: string }>(
      sql`select unit_id, exam_type_id from unit_exam_offers where unit_id = ${ana.unit.id} limit 1`,
    );
    const { unit_id: unitId, exam_type_id: examTypeId } = offer.rows[0] ?? { unit_id: '', exam_type_id: '' };
    await context.db.execute(sql`
      insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status)
      values ('exam', ${examPatient.id}, ${unitId}, ${examTypeId}, 'EX-7F3K2Q', 1, '2026-11-26T12:00:00Z',
        '2026-11-26T12:20:00Z', 'confirmed')
    `);

    const refused = [
      await adminCall('patch', `/api/admin/specialties/${ana.specialty.id}`, { isActive: false }),
      await adminCall('patch', `/api/admin/units/${ana.unit.id}`, { isActive: false }),
      await adminCall('patch', `/api/admin/exam-types/${examTypeId}`, { isActive: false }),
      await adminCall('put', `/api/admin/units/${unitId}/exam-offers/${examTypeId}`, {
        capacityPerSlot: 4,
        isActive: false,
      }),
    ];

    for (const response of refused) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'IN_USE', fields: { isActive: expect.any(String) as unknown } });
    }
    const still = await context.db.execute<{ active: boolean }>(
      sql`select is_active as active from specialties where id = ${ana.specialty.id}`,
    );
    expect(still.rows[0]?.active).toBe(true);
    await adminCall('patch', `/api/admin/specialties/${ana.specialty.id}`, { name: 'Nutrição Clínica' }).expect(200);
  });
});
