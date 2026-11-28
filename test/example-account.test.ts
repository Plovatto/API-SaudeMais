import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMaintenance } from '@/jobs/maintenance.js';
import type { BookingsService } from '@/modules/bookings/bookings.service.js';
import type { NotificationsService } from '@/modules/notifications/notifications.service.js';
import { EXAMPLE_MULTI, EXAMPLE_MULTI_ID, EXAMPLE_MULTI_PROFILE } from '@/modules/seed/seed.data.js';
import { createTestDb } from './support/create-test-db.js';
import { fixedClock } from './support/fixed-clock.js';
import { as, buildUsersApp, createAdmin, createPatient, login, START } from './support/users.js';

const credentials = { email: EXAMPLE_MULTI.email, password: EXAMPLE_MULTI.password };

async function exampleToken(app: Awaited<ReturnType<typeof seeded>>['app']) {
  return ((await login(app, credentials)).body as { token: string }).token;
}

type Seeded = Awaited<ReturnType<typeof seeded>>;

async function idOf({ db }: Seeded, table: 'units' | 'specialties', name: string) {
  const { rows } = await db.execute<{ id: string }>(sql`select id from ${sql.identifier(table)} where name = ${name}`);
  return rows[0]?.id;
}

function expectRestricted(response: request.Response) {
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ code: 'EXAMPLE_ACCOUNT_RESTRICTED' });
}

async function seeded() {
  const context = await buildUsersApp();
  await context.modules.seed.service.seed();
  await context.modules.seed.service.seedMultiProfile();
  return context;
}

describe('example account', () => {
  it('is created once with the three profiles and a doctor profile', async () => {
    const context = await seeded();

    const response = await login(context.app, credentials);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user: { id: EXAMPLE_MULTI_ID, fullName: EXAMPLE_MULTI.fullName, roles: ['admin', 'doctor', 'patient'] },
    });
    expect(await context.modules.seed.service.restoreExample()).toBe(false);
  });

  it('puts back every personal detail a visitor changed', async () => {
    const context = await seeded();
    const { db } = context;
    await db.execute(sql`
      update users set full_name = 'Visitante', email = 'outra@pessoa.com', phone = '+5511999999999',
        birth_date = '1990-01-01', password_hash = 'x', deactivated_at = now() where id = ${EXAMPLE_MULTI_ID}
    `);
    await db.execute(sql`delete from user_roles where user_id = ${EXAMPLE_MULTI_ID} and role = 'admin'`);
    await db.execute(sql`update doctor_profiles set appointment_duration_min = 45 where user_id = ${EXAMPLE_MULTI_ID}`);
    await db.execute(sql`
      insert into email_preferences (user_id, topic, enabled)
      select ${EXAMPLE_MULTI_ID}, 'booking_decision', false
    `);

    expect(await context.modules.seed.service.restoreExample()).toBe(true);

    const row = await db.execute<{
      full_name: string;
      email: string;
      phone: string | null;
      birth_date: string | null;
      deactivated_at: string | null;
    }>(sql`select full_name, email, phone, birth_date, deactivated_at from users where id = ${EXAMPLE_MULTI_ID}`);
    expect(row.rows[0]).toEqual({
      full_name: EXAMPLE_MULTI.fullName,
      email: EXAMPLE_MULTI.email,
      phone: null,
      birth_date: null,
      deactivated_at: null,
    });
    const response = await login(context.app, credentials);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { roles: ['admin', 'doctor', 'patient'] } });
    const preferences = await db.execute<{ total: number }>(
      sql`select count(*)::int as total from email_preferences where user_id = ${EXAMPLE_MULTI_ID}`,
    );
    expect(preferences.rows[0]?.total).toBe(0);
    const duration = await db.execute<{ appointment_duration_min: number | null }>(
      sql`select appointment_duration_min from doctor_profiles where user_id = ${EXAMPLE_MULTI_ID}`,
    );
    expect(duration.rows[0]?.appointment_duration_min).toBeNull();
    expect(await context.modules.seed.service.restoreExample()).toBe(false);
  });

  it('ends the sessions of whoever was using it when something had changed', async () => {
    const context = await seeded();
    const first = await login(context.app, credentials);
    const token = (first.body as { token: string }).token;
    await context.db.execute(sql`update users set full_name = 'Visitante' where id = ${EXAMPLE_MULTI_ID}`);

    await context.modules.seed.service.restoreExample();

    const me = await request(context.app).get('/api/me').set(as(token));
    expect(me.status).toBe(401);
  });

  it('cannot hand out or take away doctor and admin profiles or create lab integrations', async () => {
    const context = await seeded();
    const token = ((await login(context.app, credentials)).body as { token: string }).token;
    const visitor = await createPatient(context, 'visitante@email.com');
    const [patient] = (await context.db.execute(sql`select id from users where email = 'visitante@email.com'`))
      .rows as { id: string }[];
    const post = (path: string, body?: object) => request(context.app).post(path).set(as(token)).send(body);
    const person = { fullName: 'Carla Mendes', email: 'carla.mendes@email.com', phone: '(11) 98765-4321' };

    const refused = [
      await post(`/api/admin/users/${patient?.id}/roles/admin`),
      await post('/api/admin/users', { ...person, role: 'admin' }),
      await post('/api/admin/integration-clients', { name: 'Laboratório Visitante' }),
    ];

    await createAdmin(context, 'admin.real@email.com');
    const [admin] = (await context.db.execute(sql`select id from users where email = 'admin.real@email.com'`))
      .rows as { id: string }[];
    refused.push(
      await request(context.app).delete(`/api/admin/users/${admin?.id}/roles/admin`).set(as(token)),
      await post(`/api/admin/users/${admin?.id}/deactivate`),
    );

    const [place] = (
      await context.db.execute(sql`
        select s.id as "specialtyId", u.id as "unitId" from specialties s, units u
        where s.is_active and u.is_active limit 1
      `)
    ).rows as { specialtyId: string; unitId: string }[];
    const [doctor] = (
      await context.db.execute(sql`select user_id as id from doctor_profiles where user_id <> ${EXAMPLE_MULTI_ID} limit 1`)
    ).rows as { id: string }[];
    const doctorProfile = { ...place, registryNumber: '654321', registryUf: 'SP' };
    refused.push(
      await post('/api/admin/users', { ...person, email: 'medico.visitante@email.com', role: 'doctor', doctorProfile }),
      await post(`/api/admin/users/${patient?.id}/doctor-profile`, doctorProfile),
      await request(context.app).delete(`/api/admin/users/${doctor?.id}/doctor-profile`).set(as(token)),
      await post('/api/admin/users', { ...person, role: 'patient' }),
    );

    const patchProfile = (id: string | undefined, body: object) =>
      request(context.app).patch(`/api/admin/users/${id}/doctor-profile`).set(as(token)).send(body);
    refused.push(
      await patchProfile(EXAMPLE_MULTI_ID, { registryNumber: '777777' }),
      await patchProfile(doctor?.id, { registryNumber: '888888' }),
    );

    await context.db.execute(sql`update users set deactivated_at = now() where id in (${admin?.id}, ${doctor?.id})`);
    refused.push(
      await post(`/api/admin/users/${admin?.id}/reactivate`),
      await post(`/api/admin/users/${doctor?.id}/reactivate`),
    );

    for (const response of refused) {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'EXAMPLE_ACCOUNT_RESTRICTED' });
    }
    const created = await context.db.execute(sql`select 1 from users where email = ${person.email}`);
    expect(created.rows).toHaveLength(0);
    const reactivatedAdmins = await context.db.execute(
      sql`select 1 from users where id in (${admin?.id}, ${doctor?.id}) and deactivated_at is null`,
    );
    expect(reactivatedAdmins.rows).toHaveLength(0);
    const me = await request(context.app).get('/api/me').set(as(visitor));
    expect((me.body as { roles: string[] }).roles).toEqual(['patient']);
    const clients = await context.db.execute(sql`select 1 from integration_clients where name = 'Laboratório Visitante'`);
    expect(clients.rows).toHaveLength(0);
  });

  it('still deactivates and reactivates patients', async () => {
    const context = await seeded();
    const token = ((await login(context.app, credentials)).body as { token: string }).token;
    await createPatient(context, 'visitante@email.com');
    const [patient] = (await context.db.execute(sql`select id from users where email = 'visitante@email.com'`))
      .rows as { id: string }[];
    const post = (path: string) => request(context.app).post(path).set(as(token));

    expect((await post(`/api/admin/users/${patient?.id}/deactivate`)).status).toBe(200);
    const response = await post(`/api/admin/users/${patient?.id}/reactivate`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ deactivatedAt: null });
  });

  it('is created again when a visitor removed it', async () => {
    const context = await seeded();
    await context.db.execute(sql`delete from sessions where user_id = ${EXAMPLE_MULTI_ID}`);
    await context.db.execute(sql`delete from doctor_profiles where user_id = ${EXAMPLE_MULTI_ID}`);
    await context.db.execute(sql`delete from users where id = ${EXAMPLE_MULTI_ID}`);

    expect(await context.modules.seed.service.restoreExample()).toBe(true);

    expect((await login(context.app, credentials)).status).toBe(200);
  });

  it('does not touch another account that took its e-mail', async () => {
    const context = await seeded();
    await context.db.execute(sql`update users set email = 'livre@pessoa.com' where id = ${EXAMPLE_MULTI_ID}`);
    await context.db.execute(sql`
      insert into users (full_name, email, password_hash) values ('Outra Pessoa', ${EXAMPLE_MULTI.email}, 'x')
    `);
    const warnings: string[] = [];

    expect(await context.modules.seed.service.restoreExample(warnings)).toBe(false);

    expect(warnings).toHaveLength(1);
    const other = await context.db.execute<{ full_name: string }>(
      sql`select full_name from users where email = ${EXAMPLE_MULTI.email}`,
    );
    expect(other.rows[0]?.full_name).toBe('Outra Pessoa');
  });

  it('cannot change its own password', async () => {
    const context = await seeded();
    const token = await exampleToken(context.app);

    const response = await request(context.app)
      .post('/api/me/password')
      .set(as(token))
      .send({ currentPassword: EXAMPLE_MULTI.password, password: 'outra-senha-123', passwordConfirmation: 'outra-senha-123' });

    expectRestricted(response);
    expect((await login(context.app, credentials)).status).toBe(200);
  });

  it('cannot rename or deactivate the unit and specialty of its doctor profile', async () => {
    const context = await seeded();
    const token = await exampleToken(context.app);
    const patch = (path: string, body: object) => request(context.app).patch(path).set(as(token)).send(body);
    const unit = `/api/admin/units/${await idOf(context, 'units', EXAMPLE_MULTI_PROFILE.unit)}`;
    const specialty = `/api/admin/specialties/${await idOf(context, 'specialties', EXAMPLE_MULTI_PROFILE.specialty)}`;

    for (const response of [
      await patch(unit, { isActive: false }),
      await patch(unit, { name: 'Unidade Visitante' }),
      await patch(specialty, { isActive: false }),
      await patch(specialty, { name: 'Especialidade Visitante' }),
    ]) {
      expectRestricted(response);
    }

    expect((await patch(unit, { phone: '+551100001111' })).status).toBe(200);
    expect((await patch(specialty, { appointmentDurationMin: 20 })).status).toBe(200);
    const other = `/api/admin/units/${await idOf(context, 'units', 'Unidade Central')}`;
    expect((await patch(other, { name: 'Unidade Centro' })).status).toBe(200);
  });

  it('never sends e-mails to it, even a password reset link', async () => {
    const context = await seeded();

    await request(context.app).post('/api/password-reset/request').send({ email: EXAMPLE_MULTI.email }).expect(204);
    await context.mail.drain();

    expect(context.mailer.sent.filter(({ to }) => to === EXAMPLE_MULTI.email)).toHaveLength(0);
  });
});

describe('daily example account restore', () => {
  async function maintenanceWith(resetExample?: () => Promise<boolean>) {
    const clock = fixedClock(START);
    const maintenance = createMaintenance({
      db: await createTestDb(),
      clock,
      bookings: {
        expireOverdue: () => Promise.resolve(0),
        completeEndedExams: () => Promise.resolve(0),
        completeStaleAppointments: () => Promise.resolve(0),
      } as unknown as BookingsService,
      notifications: { forget: () => undefined } as unknown as NotificationsService,
      reminders: { remindUpcoming: () => Promise.resolve(0) },
      ...(resetExample && { resetExample }),
    });
    return { maintenance, clock };
  }

  it('runs at most once a day', async () => {
    const reset = vi.fn(() => Promise.resolve(true));
    const { maintenance, clock } = await maintenanceWith(reset);

    await maintenance.run();
    clock.advance(23 * 60 * 60_000);
    await maintenance.run();
    clock.advance(2 * 60 * 60_000);
    await maintenance.run();

    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('tries again on the next run when a restore fails', async () => {
    const reset = vi.fn().mockRejectedValueOnce(new Error('database down')).mockResolvedValue(true);
    const { maintenance } = await maintenanceWith(reset);

    expect((await maintenance.run()).exampleRestored).toBe(false);
    expect((await maintenance.run()).exampleRestored).toBe(true);
  });

  it('stays off without the flag', async () => {
    const { maintenance } = await maintenanceWith();

    expect((await maintenance.run()).exampleRestored).toBe(false);
  });
});
