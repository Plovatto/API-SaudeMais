import { sql } from 'drizzle-orm';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEMO_DOCTOR } from '@/modules/users/user.demo.js';
import { TERMS_VERSION } from '@/modules/users/user.service.js';
import { buildUsersApp, registration } from './support/users.js';

describe('POST /api/users/register', () => {
  it('refuses the e-mail reserved for a demo account even before it exists', async () => {
    const { app } = await buildUsersApp();

    const response = await request(app)
      .post('/api/users/register')
      .send(registration({ email: DEMO_DOCTOR.email.toUpperCase() }));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('creates a patient-only account with a normalized e-mail and phone', async () => {
    const { app } = await buildUsersApp();

    const response = await request(app)
      .post('/api/users/register')
      .send(registration({ email: '  Ana.Silva@Email.com ' }));

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      fullName: 'Ana Maria Silva',
      email: 'ana.silva@email.com',
      phone: '+5511987654321',
      roles: ['patient'],
    });
  });

  it('stores only a scrypt hash of the password and records the accepted terms', async () => {
    const { app, db } = await buildUsersApp();
    await request(app).post('/api/users/register').send(registration()).expect(201);

    const user = await db.execute<{
      password_hash: string;
      terms_version: string;
    }>(sql`select password_hash, terms_version from users join terms_acceptances on user_id = users.id`);

    expect(user.rows[0]?.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(user.rows[0]?.password_hash).not.toContain('senha-segura-123');
    expect(user.rows[0]?.terms_version).toBe(TERMS_VERSION);
  });

  it('refuses an e-mail that is already registered, regardless of case', async () => {
    const { app } = await buildUsersApp();
    await request(app).post('/api/users/register').send(registration()).expect(201);

    const response = await request(app)
      .post('/api/users/register')
      .send(registration({ email: 'ANA.SILVA@EMAIL.COM' }));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'EMAIL_TAKEN',
      fields: { email: 'Este e-mail já está cadastrado.' },
    });
  });

  it('accepts an account without a phone', async () => {
    const { app } = await buildUsersApp();

    const response = await request(app)
      .post('/api/users/register')
      .send(registration({ phone: '' }));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ phone: null });
  });

  it.each([
    ['a short name', { fullName: 'A' }, 'fullName'],
    ['a single emoji as the name', { fullName: '😀' }, 'fullName'],
    ['a control character in the name', { fullName: 'Ana\u0000Silva' }, 'fullName'],
    ['an invalid e-mail', { email: 'ana' }, 'email'],
    ['an invalid phone', { phone: '123' }, 'phone'],
    ['a short password', { password: 'curta', passwordConfirmation: 'curta' }, 'password'],
    ['a different confirmation', { passwordConfirmation: 'outra-senha-123' }, 'passwordConfirmation'],
    ['terms not accepted', { acceptTerms: false }, 'acceptTerms'],
  ])('rejects %s with a field error', async (_case, overrides, field) => {
    const { app } = await buildUsersApp();

    const response = await request(app).post('/api/users/register').send(registration(overrides));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((response.body as { fields: Record<string, string> }).fields).toHaveProperty(field);
  });

  it('rejects unknown fields, so nobody can grant themselves a role', async () => {
    const { app } = await buildUsersApp();

    const response = await request(app)
      .post('/api/users/register')
      .send(registration({ roles: ['admin'] }));

    expect(response.status).toBe(400);
  });

  it('limits sign-ups from the same address', async () => {
    const { app } = await buildUsersApp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app).post('/api/users/register').send({}).expect(400);
    }

    const response = await request(app).post('/api/users/register').send(registration());

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
