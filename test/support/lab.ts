import { sql, type SQL } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import { newPublicCode } from '@/modules/exam-bookings/exam-bookings.code.js';
import type { Clinic } from './doctors.js';
import type { Offer } from './exams.js';
import { as, createPatient, START } from './users.js';

type Db = Clinic['db'];

export type ExamStatus = 'confirmed' | 'completed' | 'cancelled';

export interface Exam {
  id: string;
  code: string;
}

export const ISSUED_AT = '2026-11-20T11:30:00.000Z';

export async function rowsOf<T>(db: Db, query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

export async function valueOf<T>(db: Db, query: SQL): Promise<T> {
  const [row] = await rowsOf<{ value: T }>(db, query);
  if (!row) throw new Error('No row');
  return row.value;
}

export async function createAdmin(context: Clinic, email: string): Promise<string> {
  const token = await createPatient(context, email);
  await context.db.execute(sql`
    update user_roles set role = 'admin'
    where role = 'patient' and user_id = (select id from users where email = ${email})
  `);
  return token;
}

export async function createLabKey(app: Express, admin: string, name: string): Promise<string> {
  const response = await request(app).post('/api/admin/integration-clients').set(as(admin)).send({ name }).expect(201);
  return (response.body as { apiKey: string }).apiKey;
}

export const publishResult = (app: Express, key: string, body: Record<string, unknown>) =>
  request(app).post('/api/integrations/lab/results').set('X-Api-Key', key).send(body);

export async function insertExam(
  db: Db,
  patientId: string,
  offer: Offer,
  startsAt: string,
  status: ExamStatus = 'confirmed',
): Promise<Exam> {
  const code = newPublicCode();
  const cancelled = status === 'cancelled' ? sql`${START}::timestamptz, 'system'` : sql`null, null`;
  const id = await valueOf<string>(
    db,
    sql`
      insert into bookings (kind, patient_id, unit_id, exam_type_id, public_code, lane, starts_at, ends_at, status,
        cancelled_at, cancelled_by_role)
      values ('exam', ${patientId}, ${offer.unitId}, ${offer.examTypeId}, ${code}, 1, ${startsAt}::timestamptz,
        ${startsAt}::timestamptz + interval '10 minutes', ${status}, ${cancelled})
      returning id as value
    `,
  );
  return { id, code };
}
