import '../../docs/zod-extend.js';
import { z } from 'zod';
import { bookingActorTypes, bookingEventTypes, bookingStatuses, visitTypes } from '../../database/schema/bookings.js';
import { registry } from '../../docs/registry.js';
import { uuidParam } from '../../lib/params.js';
import { boundedText } from '../../lib/text.js';
import { doctorSchema } from '../doctors/doctors.model.js';

const visitType = z.enum(visitTypes, { error: 'Escolha o tipo de consulta.' }).openapi({
  description:
    'Tipo de consulta: primeira consulta (`first_visit`), rotina (`routine`), retorno (`follow_up`) ou avaliação de exames (`exam_review`).',
  example: 'first_visit',
});

export const bookAppointmentSchema = registry.register(
  'BookAppointmentRequest',
  z.strictObject({
    doctorId: uuidParam.openapi({ description: 'Médico escolhido.' }),
    specialtyId: uuidParam.openapi({ description: 'Especialidade escolhida; precisa ser a do médico.' }),
    visitType,
    startsAt: z.iso
      .datetime({ offset: true, error: 'Envie o startsAt de uma vaga da lista.' })
      .openapi({ description: 'Início da vaga, como veio da lista de vagas.', example: '2026-11-23T11:00:00.000Z' }),
    notes: boundedText('O texto das observações', 0, 500)
      .optional()
      .openapi({ description: 'Observações para o médico.', example: 'Tenho alergia a dipirona.' }),
  }),
);

const person = z.object({ id: z.uuid(), fullName: z.string().openapi({ example: 'Ana Maria Silva' }) });

const eventSchema = z.object({
  type: z.enum(bookingEventTypes).openapi({ example: 'created' }),
  actorType: z.enum(bookingActorTypes).openapi({ example: 'patient' }),
  fromStatus: z.enum(bookingStatuses).nullable(),
  toStatus: z.enum(bookingStatuses).openapi({ example: 'pending' }),
  fromStartsAt: z.iso.datetime().nullable().openapi({ description: 'Horário anterior; só em `rescheduled`.' }),
  toStartsAt: z.iso.datetime().nullable().openapi({ description: 'Horário novo; só em `rescheduled`.' }),
  createdAt: z.iso.datetime(),
});

export const appointmentSchema = registry.register(
  'Appointment',
  z.object({
    id: z.uuid(),
    status: z.enum(bookingStatuses).openapi({
      description: 'Situação da consulta. Pedido pendente cujo horário já chegou aparece como `expired`.',
      example: 'pending',
    }),
    visitType,
    startsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:00:00.000Z' }),
    endsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:30:00.000Z' }),
    notes: z.string().nullable().openapi({ description: 'Observações do paciente; só ele e o médico veem.' }),
    patient: person,
    doctor: person.openapi({ example: { id: '019a8f2e-7c41-7d2a-9b1e-3f5a6c7d8e9f', fullName: 'Dr. Carlos Mendes' } }),
    specialty: doctorSchema.shape.specialty,
    unit: doctorSchema.shape.unit,
    createdAt: z.iso.datetime(),
    events: z.array(eventSchema).openapi({ description: 'Histórico da consulta, do mais antigo para o mais novo.' }),
  }),
);

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
