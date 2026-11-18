import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { Clinic, Doctor } from './doctors.js';
import { as } from './users.js';

export interface Item {
  id: string;
  status: string;
  startsAt: string;
  actions: { canConfirm: boolean; canCancel: boolean; canComplete: boolean; canNoShow: boolean };
  [key: string]: unknown;
}

export interface Counts {
  pending: number;
  confirmed: number;
  awaiting: number;
  history: number;
}

export interface AgendaPage {
  items: Item[];
  page: number;
  pageSize: number;
  total: number;
  counts: Counts;
}

export const UNKNOWN_ID = '0190a5d2-6b7e-7c3a-9f1e-2d4c6b8a0e13';
export const NO_ACTIONS = { canConfirm: false, canCancel: false, canComplete: false, canNoShow: false };
export const RECORDABLE = { ...NO_ACTIONS, canComplete: true, canNoShow: true };

export const ids = (items: Item[]) => items.map((item) => item.id);

export interface Attending {
  patient: string;
  doctor: string;
  owner: Doctor;
}

export function agendaHelpers(clinic: () => Clinic) {
  const app = () => clinic().app;
  const book = async (token: string, doctor: Doctor, startsAt: string, notes?: string): Promise<Item> => {
    const response = await request(app())
      .post('/api/appointments')
      .set(as(token))
      .send({ doctorId: doctor.id, specialtyId: doctor.specialty.id, visitType: 'routine', startsAt, notes })
      .expect(201);
    return response.body as Item;
  };
  const confirm = (token: string, id: string, body: Record<string, unknown>) =>
    request(app()).post(`/api/appointments/${id}/confirm`).set(as(token)).send(body);
  const moveTo = (id: string, startsAt: string) =>
    clinic().db.execute(sql`
      update bookings set starts_at = ${startsAt}::timestamptz, ends_at = ${startsAt}::timestamptz + (ends_at - starts_at)
      where id = ${id}
    `);
  return {
    book,
    list: (token: string, query: Record<string, string | number> = {}) =>
      request(app()).get('/api/doctor/appointments').query(query).set(as(token)),
    confirm,
    cancel: (token: string, id: string, startsAt: string) =>
      request(app()).post(`/api/appointments/${id}/cancel`).set(as(token)).send({ startsAt }).expect(200),
    moveTo,
    started: async ({ patient, doctor, owner }: Attending, startsAt: string, at: string): Promise<Item> => {
      const booked = await book(patient, owner, startsAt);
      await confirm(doctor, booked.id, { startsAt }).expect(200);
      await moveTo(booked.id, at);
      return { ...booked, startsAt: at };
    },
    record: (token: string, action: string, id: string, body: Record<string, unknown>) =>
      request(app()).post(`/api/appointments/${id}/${action}`).set(as(token)).send(body),
  };
}
