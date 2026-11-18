import { sql } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { WEEKDAYS, WORKDAYS } from '@/lib/week.js';
import { bookedBy, rescheduleOn, slot } from './support/bookings.js';
import { availability, createDoctor, setupClinic, type Availability, type Clinic, type Doctor } from './support/doctors.js';
import { anyText, as, createPatient } from './support/users.js';

const PATH = '/api/doctor/time-off';
const MONDAY = '2026-11-23';
const TUESDAY = '2026-11-24';

interface Booking {
  id: string;
  startsAt: string;
  endsAt: string;
}

let context: Clinic;
let doctor: Doctor;
let token: string;
let counter = 0;

beforeAll(async () => {
  context = await setupClinic();
  const created = await createDoctor(context, 'folgas.medico@email.com', 'Dra. Folga Teste', '800001');
  doctor = created.doctor;
  token = created.token;
}, 60_000);

const block = (body: Record<string, unknown>, by = token) => request(context.app).post(PATH).set(as(by)).send(body);
const unblock = (date: string, by = token) => request(context.app).delete(`${PATH}/${date}`).set(as(by));
const blocked = async (by = token) => (await request(context.app).get(PATH).set(as(by)).expect(200)).body as unknown[];

const appointmentBody = (startsAt: string) => ({
  doctorId: doctor.id,
  specialtyId: doctor.specialty.id,
  visitType: 'routine',
  startsAt,
});

const booked = async (startsAt: string) => {
  counter += 1;
  return bookedBy<Booking>(context, `paciente.folga${counter}@email.com`, '/api/appointments', appointmentBody(startsAt));
};

async function slotsOn(date: string) {
  const response = await availability(context, context.patient, doctor.id, { from: date, to: date }).expect(200);
  return (response.body as Availability).days.find((day) => day.date === date)?.slots ?? [];
}

async function auditCount(action: string) {
  const rows = await context.db.execute<{ total: number }>(
    sql`select count(*)::int as total from audit_logs where action = ${action}`,
  );
  return rows.rows[0]?.total ?? 0;
}

describe('access', () => {
  it('answers 401 without a session and 403 to accounts without the doctor profile', async () => {
    const patient = await createPatient(context, 'sem.perfil.folga@email.com');

    expect((await request(context.app).get(PATH)).status).toBe(401);
    expect((await request(context.app).post(PATH).send({ date: TUESDAY })).status).toBe(401);
    expect((await request(context.app).delete(`${PATH}/${TUESDAY}`)).status).toBe(401);
    expect((await request(context.app).get(PATH).set(as(patient))).status).toBe(403);
    expect((await block({ date: TUESDAY }, patient)).status).toBe(403);
    expect((await unblock(TUESDAY, patient)).status).toBe(403);
  });
});

describe('POST, GET and DELETE /api/doctor/time-off', () => {
  it('blocks a day with a trimmed reason, lists it and unblocks it, recording both in the audit log', async () => {
    const created = await block({ date: '2026-12-24', reason: '  Congresso de cardiologia  ' });

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ date: '2026-12-24', reason: 'Congresso de cardiologia', warnings: [] });
    expect(await blocked()).toContainEqual({ date: '2026-12-24', reason: 'Congresso de cardiologia' });
    expect(await auditCount('doctor_time_off.created')).toBeGreaterThan(0);

    expect((await unblock('2026-12-24')).status).toBe(204);
    expect(await blocked()).not.toContainEqual(expect.objectContaining({ date: '2026-12-24' }));
    expect(await auditCount('doctor_time_off.deleted')).toBeGreaterThan(0);
    expect((await unblock('2026-12-24')).status).toBe(404);
  });

  it('stores an empty or missing reason as null', async () => {
    expect((await block({ date: '2026-12-28', reason: '   ' })).body).toMatchObject({ reason: null });
    expect((await block({ date: '2026-12-29' })).body).toMatchObject({ reason: null });
  });

  it('accepts today and days beyond the booking horizon, and lists them in date order', async () => {
    expect((await block({ date: '2026-11-20' })).status).toBe(201);
    expect((await block({ date: '2027-06-01' })).status).toBe(201);

    const dates = ((await blocked()) as { date: string }[]).map((entry) => entry.date);
    expect(dates).toEqual(dates.toSorted());
    expect(dates).toContain('2026-11-20');
    expect(dates).toContain('2027-06-01');
  });

  it('leaves past days out of the list', async () => {
    await context.db.execute(sql`insert into doctor_time_off (doctor_id, date) values (${doctor.id}, '2026-11-10')`);

    expect(await blocked()).not.toContainEqual(expect.objectContaining({ date: '2026-11-10' }));
  });

  it('accepts days up to 365 days ahead and refuses later ones with 422 DATE_TOO_FAR', async () => {
    const farthest = await block({ date: '2027-11-20' });
    const tooFar = await block({ date: '2027-11-21' });

    expect(farthest.status).toBe(201);
    expect(tooFar.status).toBe(422);
    expect(tooFar.body).toMatchObject({ code: 'DATE_TOO_FAR', fields: { date: anyText } });
  });

  it('refuses to unblock a past day with 422 PAST_DATE', async () => {
    await context.db.execute(sql`insert into doctor_time_off (doctor_id, date) values (${doctor.id}, '2026-11-11')`);
    const response = await unblock('2026-11-11');

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'PAST_DATE' });
  });

  it('refuses a past day with 422 PAST_DATE and a blocked day with 409 TIME_OFF_EXISTS', async () => {
    const past = await block({ date: '2026-11-19' });
    await block({ date: '2027-01-04' }).expect(201);
    const again = await block({ date: '2027-01-04', reason: 'De novo' });

    expect(past.status).toBe(422);
    expect(past.body).toMatchObject({ code: 'PAST_DATE', fields: { date: anyText } });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'TIME_OFF_EXISTS', fields: { date: anyText } });
  });

  it('rejects invalid input with 400', async () => {
    const invalid = [
      {},
      { date: '2026-02-30' },
      { date: '24/12/2026' },
      { date: '2026-12-30', reason: 'a'.repeat(81) },
      { date: '2026-12-30', extra: true },
    ];
    for (const body of invalid) {
      expect((await block(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await unblock('amanha')).status).toBe(400);
  });
});

describe('blocked days and bookings', () => {
  it('removes the day from the availability and refuses booking or rescheduling into it', async () => {
    const before = await slotsOn(TUESDAY);
    const { token: patient, booking } = await booked(slot('2026-11-25', '11:00'));
    await block({ date: TUESDAY }).expect(201);

    const firstSlot = before[0]?.startsAt ?? '';
    const booking2 = await request(context.app).post('/api/appointments').set(as(patient)).send(appointmentBody(firstSlot));
    const moved = await rescheduleOn(context, '/api/appointments', patient, booking.id, {
      startsAt: booking.startsAt,
      newStartsAt: firstSlot,
    });

    expect(before.length).toBeGreaterThan(0);
    expect(await slotsOn(TUESDAY)).toEqual([]);
    expect(booking2.status).toBe(422);
    expect(booking2.body).toMatchObject({ code: 'OUTSIDE_AVAILABILITY' });
    expect(moved.status).toBe(422);
    expect(moved.body).toMatchObject({ code: 'OUTSIDE_AVAILABILITY' });

    await unblock(TUESDAY).expect(204);
    expect(await slotsOn(TUESDAY)).toEqual(before);
  });

  it('warns about pending and confirmed appointments already on the day without cancelling them', async () => {
    const pending = (await booked(slot('2026-11-26', '11:00'))).booking;
    const confirmed = (await booked(slot('2026-11-26', '12:00'))).booking;
    const cancelled = await booked(slot('2026-11-26', '13:00'));
    await context.db.execute(sql`update bookings set status = 'confirmed' where id = ${confirmed.id}`);
    await request(context.app)
      .post(`/api/appointments/${cancelled.booking.id}/cancel`)
      .set(as(cancelled.token))
      .send({ startsAt: cancelled.booking.startsAt })
      .expect(200);

    const response = await block({ date: '2026-11-26' }).expect(201);
    const statuses = await context.db.execute<{ status: string }>(
      sql`select status from bookings where id in (${pending.id}, ${confirmed.id}) order by starts_at`,
    );

    expect((response.body as { warnings: unknown[] }).warnings).toEqual([
      { appointmentId: pending.id, startsAt: pending.startsAt },
      { appointmentId: confirmed.id, startsAt: confirmed.startsAt },
    ]);
    expect(statuses.rows.map((row) => row.status)).toEqual(['pending', 'confirmed']);
  });
});

describe('appointment duration', () => {
  const week = (appointmentDurationMin: number | null) => ({
    appointmentDurationMin,
    days: WEEKDAYS.map((weekday) => {
      const isActive = (WORKDAYS as readonly number[]).includes(weekday);
      return {
        weekday,
        isActive,
        ranges: isActive
          ? [
              { startMin: 480, endMin: 720 },
              { startMin: 780, endMin: 1020 },
            ]
          : [],
      };
    }),
  });
  const saveWeek = (minutes: number | null) =>
    request(context.app).put('/api/doctor/schedule').set(as(token)).send(week(minutes)).expect(200);

  it('builds slots and bookings with the doctor duration and keeps existing bookings after a reset', async () => {
    await saveWeek(45);
    const slots = await slotsOn(MONDAY);
    const { booking } = await booked(slots[0]?.startsAt ?? '');
    await saveWeek(null);

    expect(slots).toHaveLength(10);
    expect(slots[0]).toEqual({ startsAt: slot(MONDAY, '11:00'), endsAt: slot(MONDAY, '11:45') });
    expect(booking).toMatchObject({ startsAt: slot(MONDAY, '11:00'), endsAt: slot(MONDAY, '11:45') });
    expect((await slotsOn(MONDAY)).length).toBe(14);
    expect(await context.db.execute(sql`select 1 from bookings where id = ${booking.id}`)).toMatchObject({
      rows: [{ '?column?': 1 }],
    });
  });
});
