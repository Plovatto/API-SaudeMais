import type { SQL } from 'drizzle-orm';
import type { Express } from 'express';
import request from 'supertest';
import type { Clinic } from './doctors.js';
import { as } from './users.js';

type Db = Clinic['db'];

export interface Exam {
  id: string;
  code: string;
}

export interface ClientBody {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  apiKey?: string;
}

export const ISSUED_AT = '2026-11-20T11:30:00.000Z';

let clientNames = 0;

export async function rowsOf<T>(db: Db, query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

export async function valueOf<T>(db: Db, query: SQL): Promise<T> {
  const [row] = await rowsOf<{ value: T }>(db, query);
  if (!row) throw new Error('No row');
  return row.value;
}

export const postIntegrationClient = (app: Express, token: string, name: string) =>
  request(app).post('/api/admin/integration-clients').set(as(token)).send({ name });

export async function createIntegrationClient(
  app: Express,
  admin: string,
  name = `Laboratório ${(clientNames += 1)}`,
): Promise<ClientBody> {
  return (await postIntegrationClient(app, admin, name).expect(201)).body as ClientBody;
}

export async function createLabKey(app: Express, admin: string): Promise<string> {
  return (await createIntegrationClient(app, admin)).apiKey ?? '';
}

export const publishResult = (app: Express, key: string, body: Record<string, unknown>) =>
  request(app).post('/api/integrations/lab/results').set('X-Api-Key', key).send(body);
