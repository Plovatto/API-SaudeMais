import '../../docs/zod-extend.js';
import { z } from 'zod';
import { bookingStatuses } from '../../database/schema/bookings.js';
import { registry } from '../../docs/registry.js';
import { uuidParam } from '../../lib/params.js';
import { boundedText } from '../../lib/text.js';
import { bookingEventSchema, cancellationSchema, instant, seenStartsAt } from '../appointments/appointments.model.js';
import { examTypeSchema } from '../catalog/catalog.model.js';
import { doctorSchema, periodShape, slotSchema, withPeriodRules } from '../doctors/doctors.model.js';

const offerShape = {
  unitId: uuidParam.openapi({ description: 'Unidade escolhida.' }),
  examTypeId: uuidParam.openapi({ description: 'Tipo de exame escolhido.' }),
};

export const examAvailabilityQuery = withPeriodRules(z.strictObject({ ...offerShape, ...periodShape }));

export const examAvailabilitySchema = registry.register(
  'ExamAvailability',
  z.object({
    days: z
      .array(
        z.object({
          date: z.iso.date().openapi({ description: 'Dia no fuso de São Paulo.', example: '2026-11-23' }),
          slots: z
            .array(
              slotSchema.extend({
                remaining: z.int().positive().openapi({
                  description: 'Lugares livres na vaga: a capacidade da oferta menos os exames que a ocupam.',
                  example: 3,
                }),
              }),
            )
            .openapi({ description: 'Vagas do dia com ao menos um lugar livre, em ordem.' }),
        }),
      )
      .openapi({ description: 'Só os dias do período com ao menos uma vaga livre, em ordem.' }),
  }),
);

export const bookExamSchema = registry.register(
  'BookExamRequest',
  z.strictObject({
    ...offerShape,
    startsAt: instant('Envie o startsAt de uma vaga da lista.', 'Início da vaga, como veio da lista de vagas.'),
    notes: boundedText('O texto das observações', 0, 500, { multiline: true })
      .optional()
      .openapi({ description: 'Observações para a unidade.', example: 'Tenho dificuldade de locomoção.' }),
  }),
);

export const cancelExamSchema = registry.register('CancelExamRequest', z.strictObject({ startsAt: seenStartsAt }));

export const examBookingSchema = registry.register(
  'ExamBooking',
  z.object({
    id: z.uuid(),
    status: z.enum(bookingStatuses).openapi({
      description: 'Situação do exame: nasce `confirmed` e pode ser `cancelled` ou `completed`.',
      example: 'confirmed',
    }),
    publicCode: z.string().openapi({ description: 'Código para apresentar na unidade.', example: 'EX-7F3K2Q' }),
    startsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:00:00.000Z' }),
    endsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:10:00.000Z' }),
    notes: z.string().nullable().openapi({ description: 'Observações do paciente.' }),
    examType: examTypeSchema.pick({ id: true, name: true, kind: true, preparationNotes: true }),
    unit: doctorSchema.shape.unit,
    cancellation: cancellationSchema,
    createdAt: z.iso.datetime(),
    events: z
      .array(bookingEventSchema)
      .openapi({ description: 'Histórico do exame, do mais antigo para o mais novo.' }),
  }),
);

export type ExamAvailabilityQuery = z.infer<typeof examAvailabilityQuery>;
export type ExamAvailability = z.infer<typeof examAvailabilitySchema>;
export type BookExamInput = z.infer<typeof bookExamSchema>;
export type CancelExamInput = z.infer<typeof cancelExamSchema>;
export type ExamBooking = z.infer<typeof examBookingSchema>;
