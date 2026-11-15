import type { Express } from 'express';
import request from 'supertest';
import type { UserService } from '@/modules/users/user.service.js';
import { as, createPatient } from './users.js';

type BookingPath = '/api/appointments' | '/api/exam-bookings';

interface Booker {
  app: Express;
  auth: UserService;
}

export const slot = (date: string, time: string) => `${date}T${time}:00.000Z`;

export async function bookedBy<T>(context: Booker, email: string, path: BookingPath, body: Record<string, unknown>) {
  const token = await createPatient(context, email);
  const response = await request(context.app).post(path).set(as(token)).send(body).expect(201);
  return { token, booking: response.body as T };
}

export function rescheduleOn(
  { app }: Pick<Booker, 'app'>,
  path: BookingPath,
  token: string,
  id: string,
  body: Record<string, unknown>,
) {
  return request(app).post(`${path}/${id}/reschedule`).set(as(token)).send(body);
}
