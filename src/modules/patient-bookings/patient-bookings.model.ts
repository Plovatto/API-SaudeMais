import '../../docs/zod-extend.js';
import { z } from 'zod';
import { bookingKinds, bookingStatuses } from '../../database/schema/bookings.js';
import { nullableRef } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';
import {
  bookingActionsSchema,
  cancellationSchema,
  metricFields,
  person,
  visitType,
} from '../appointments/appointments.model.js';
import { doctorSchema } from '../doctors/doctors.model.js';
import { notificationSchema } from '../notifications/notifications.model.js';

export const bookingScopes = ['upcoming', 'past'] as const;

export const patientBookingsQuery = paginationQuery.extend({
  scope: z.enum(bookingScopes, { error: 'Escolha entre agendados e realizados.' }).default('upcoming').openapi({
    description:
      'Aba da lista: agendados (`upcoming`, pendentes e confirmados que ainda não começaram, do mais próximo para o mais distante) ou realizados (`past`, todo o resto, do mais recente para o mais antigo).',
  }),
  kind: z
    .enum(bookingKinds, { error: 'Escolha entre consulta e exame.' })
    .optional()
    .openapi({ description: 'Só consultas (`appointment`) ou só exames (`exam`).' }),
  status: z
    .enum(bookingStatuses, { error: 'Escolha uma situação válida.' })
    .optional()
    .openapi({ description: 'Só agendamentos nesta situação, já com `expired` calculado.' }),
});

export const patientBookingSchema = registry.register(
  'PatientBooking',
  z.object({
    id: z.uuid(),
    kind: z.enum(bookingKinds).openapi({ example: 'appointment' }),
    status: z.enum(bookingStatuses).openapi({
      description:
        'Situação do agendamento. Pedido pendente cujo horário já chegou aparece como `expired`; consulta `confirmed` que já começou, em realizados, é a que aguarda o registro do médico.',
      example: 'confirmed',
    }),
    startsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:00:00.000Z' }),
    endsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:30:00.000Z' }),
    notes: z.string().nullable().openapi({ description: 'Observações do paciente.' }),
    visitType: visitType.nullable().openapi({ description: 'Tipo de consulta; nulo em exames.' }),
    doctor: person.nullable().openapi({ description: 'Médico da consulta; nulo em exames.' }),
    specialty: doctorSchema.shape.specialty.nullable().openapi({ description: 'Especialidade; nula em exames.' }),
    examType: z
      .object({ id: z.uuid(), name: z.string().openapi({ example: 'Hemograma completo' }) })
      .nullable()
      .openapi({ description: 'Tipo de exame; nulo em consultas.' }),
    publicCode: z
      .string()
      .nullable()
      .openapi({ description: 'Código do exame para apresentar na unidade; nulo em consultas.', example: null }),
    hasResult: z.boolean().openapi({
      description:
        'Se o exame já tem resultado, aberto em `GET /api/patient/exam-results/{bookingId}`; sempre falso em consultas.',
    }),
    unit: doctorSchema.shape.unit,
    cancellation: cancellationSchema,
    actions: bookingActionsSchema,
  }),
);

const countsSchema = z
  .object({
    upcoming: z.int().nonnegative().openapi({ example: 2 }),
    past: z.int().nonnegative().openapi({ example: 7 }),
  })
  .openapi({ description: 'Totais das abas agendados e realizados, sem os filtros.' });

export const patientBookingPageSchema = registry.register(
  'PatientBookingPage',
  paginatedSchema(patientBookingSchema).extend({ counts: countsSchema }),
);

const recordedAt = z.iso.datetime().openapi({ description: 'Quando a medida foi registrada na consulta.' });

const bloodPressureSchema = registry.register(
  'BloodPressureReading',
  z
    .object({ systolic: metricFields.systolic, diastolic: metricFields.diastolic, recordedAt })
    .openapi({ description: 'A pressão mais recente registrada pelo médico ao concluir uma consulta.' }),
);

const weightSchema = registry.register(
  'WeightReading',
  z
    .object({ kg: metricFields.weightKg, recordedAt })
    .openapi({ description: 'O peso mais recente registrado pelo médico ao concluir uma consulta.' }),
);

export const patientHomeSchema = registry.register(
  'PatientHome',
  z.object({
    upcoming: z
      .array(patientBookingSchema)
      .openapi({ description: 'Os próximos agendamentos, do mais próximo para o mais distante.' }),
    counts: countsSchema,
    lastNotification: nullableRef(notificationSchema).openapi({
      description: 'O aviso mais recente do perfil de paciente, lido ou não.',
    }),
    metrics: z
      .object({
        bloodPressure: nullableRef(bloodPressureSchema).openapi({
          description: 'A pressão mais recente; nula enquanto nenhuma consulta a registrou.',
        }),
        weight: nullableRef(weightSchema).openapi({
          description: 'O peso mais recente; nulo enquanto nenhuma consulta o registrou.',
        }),
      })
      .openapi({ description: 'Cartões de pressão e peso, cada um com a medida mais recente do paciente.' }),
  }),
);

export type BookingScope = (typeof bookingScopes)[number];
export type PatientBookingsQuery = z.infer<typeof patientBookingsQuery>;
export type PatientBookingPage = z.infer<typeof patientBookingPageSchema>;
export type PatientHome = z.infer<typeof patientHomeSchema>;
export type PatientMetrics = PatientHome['metrics'];
