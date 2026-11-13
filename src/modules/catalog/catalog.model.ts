import '../../docs/zod-extend.js';
import { uuidParam } from '../../lib/params.js';
import { z } from 'zod';
import { examKinds } from '../../database/schema/catalog.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema } from '../../lib/pagination.js';
import { boundedText } from '../../lib/text.js';
import { phoneNumber } from '../users/user.model.js';

const catalogName = boundedText('O nome', 2, 80);

const duration = (min: number, max: number) =>
  z
    .number()
    .int('Use minutos inteiros.')
    .min(min, `A duração mínima é de ${min} minutos.`)
    .max(max, `A duração máxima é de ${max} minutos.`)
    .multipleOf(5, 'Use múltiplos de 5 minutos.');

const nonEmpty = <T extends Record<string, unknown>>(data: T) =>
  Object.values(data).some((value) => value !== undefined);
const nonEmptyIssue = { message: 'Envie pelo menos um campo para alterar.' };

export const offerParams = z.strictObject({ id: uuidParam, examTypeId: uuidParam });

const specialtyFields = {
  name: catalogName.openapi({ example: 'Cardiologia' }),
  council: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3,10}$/, 'Use a sigla do conselho, de 3 a 10 letras.')
    .openapi({ description: 'Conselho profissional da especialidade.', example: 'CRM' }),
  appointmentDurationMin: duration(10, 240).openapi({ description: 'Duração padrão da consulta.', example: 30 }),
};

export const createSpecialtySchema = registry.register(
  'CreateSpecialtyRequest',
  z.strictObject({ ...specialtyFields, appointmentDurationMin: specialtyFields.appointmentDurationMin.default(30) }),
);

export const updateSpecialtySchema = registry.register(
  'UpdateSpecialtyRequest',
  z
    .strictObject({
      name: specialtyFields.name.optional(),
      council: specialtyFields.council.optional(),
      appointmentDurationMin: specialtyFields.appointmentDurationMin.optional(),
      isActive: z.boolean().optional(),
    })
    .refine(nonEmpty, nonEmptyIssue),
);

export const specialtySchema = registry.register(
  'Specialty',
  z.object({ id: z.uuid(), ...specialtyFields, isActive: z.boolean() }),
);

const unitHourSchema = z
  .strictObject({
    weekday: z.number().int().min(0).max(6).openapi({ description: '0 = domingo.', example: 1 }),
    openMin: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .openapi({ description: 'Abertura, em minutos desde 00:00.', example: 480 }),
    closeMin: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .openapi({ description: 'Fechamento, em minutos desde 00:00.', example: 1080 }),
  })
  .refine((hour) => hour.openMin < hour.closeMin, {
    path: ['closeMin'],
    message: 'O fechamento precisa ser depois da abertura.',
  });

const unitHours = z
  .array(unitHourSchema)
  .max(7)
  .refine((hours) => new Set(hours.map((hour) => hour.weekday)).size === hours.length, 'Informe cada dia uma vez só.')
  .openapi({ description: 'Horário de cada dia em que a unidade abre; dias ausentes ficam fechados.' });

const unitFields = {
  name: catalogName.openapi({ example: 'Unidade Central' }),
  address: boundedText('O endereço', 5, 200).openapi({ example: 'Rua das Flores, 123 - Centro' }),
  phone: phoneNumber.openapi({ example: '(11) 3333-4444' }),
  hours: unitHours,
};

export const createUnitSchema = registry.register(
  'CreateUnitRequest',
  z.strictObject({ ...unitFields, hours: unitFields.hours.default([]) }),
);

export const updateUnitSchema = registry.register(
  'UpdateUnitRequest',
  z
    .strictObject({
      name: unitFields.name.optional(),
      address: unitFields.address.optional(),
      phone: unitFields.phone.optional(),
      hours: unitFields.hours.optional(),
      isActive: z.boolean().optional(),
    })
    .refine(nonEmpty, nonEmptyIssue),
);

export const unitSchema = registry.register(
  'Unit',
  z.object({
    id: z.uuid(),
    name: z.string(),
    address: z.string(),
    phone: z.string().openapi({ example: '+551133334444' }),
    isActive: z.boolean(),
    hours: z.array(z.object({ weekday: z.number().int(), openMin: z.number().int(), closeMin: z.number().int() })),
  }),
);

const examTypeFields = {
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use letras minúsculas, números e _, começando por letra.')
    .openapi({ description: 'Código estável, usado na integração com o laboratório.', example: 'hemograma' }),
  name: catalogName.openapi({ example: 'Hemograma' }),
  kind: z.enum(examKinds).openapi({ description: '`lab` para exames laboratoriais, `imaging` para imagem.' }),
  durationMin: duration(5, 240).openapi({ example: 15 }),
  preparationNotes: z
    .string()
    .trim()
    .max(1000, 'As orientações podem ter até 1000 caracteres.')
    .nullable()
    .openapi({ example: 'Jejum de 8 horas.' }),
};

export const createExamTypeSchema = registry.register(
  'CreateExamTypeRequest',
  z.strictObject({ ...examTypeFields, preparationNotes: examTypeFields.preparationNotes.default(null) }),
);

export const updateExamTypeSchema = registry.register(
  'UpdateExamTypeRequest',
  z
    .strictObject({
      code: examTypeFields.code.optional(),
      name: examTypeFields.name.optional(),
      kind: examTypeFields.kind.optional(),
      durationMin: examTypeFields.durationMin.optional(),
      preparationNotes: examTypeFields.preparationNotes.optional(),
      isActive: z.boolean().optional(),
    })
    .refine(nonEmpty, nonEmptyIssue),
);

export const examTypeSchema = registry.register(
  'ExamType',
  z.object({ id: z.uuid(), ...examTypeFields, isActive: z.boolean() }),
);

export const saveOfferSchema = registry.register(
  'SaveExamOfferRequest',
  z.strictObject({
    capacityPerSlot: z
      .number()
      .int()
      .min(1, 'A capacidade mínima é 1.')
      .max(50, 'A capacidade máxima é 50.')
      .openapi({ description: 'Quantos exames iguais a unidade faz ao mesmo tempo.', example: 3 }),
    isActive: z.boolean().default(true),
  }),
);

export const examOfferSchema = registry.register(
  'ExamOffer',
  z.object({
    examTypeId: z.uuid(),
    examTypeName: z.string().openapi({ example: 'Hemograma' }),
    capacityPerSlot: z.number().int(),
    isActive: z.boolean(),
  }),
);

const policyFields = {
  appointmentLateWindowHours: z.number().int().min(0).max(168).openapi({
    description: 'Antecedência, em horas, abaixo da qual cancelar uma consulta é tardio e reagendar é bloqueado.',
    example: 24,
  }),
  examLateWindowHours: z.number().int().min(0).max(168).openapi({ description: 'O mesmo, para exames.', example: 2 }),
  maxReschedules: z
    .number()
    .int()
    .min(0)
    .max(10)
    .openapi({ description: 'Reagendamentos por agendamento.', example: 2 }),
  bookingHorizonDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .openapi({ description: 'Até quantos dias à frente se agenda.', example: 60 }),
  minLeadMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080)
    .openapi({ description: 'Antecedência mínima, em minutos, para agendar.', example: 60 }),
};

export const policyInputSchema = registry.register('UpdatePolicyRequest', z.strictObject(policyFields));
export const policySchema = registry.register('Policy', z.object({ ...policyFields, updatedAt: z.iso.datetime() }));

export const unitsQuery = z.strictObject({
  examTypeId: z
    .uuid('Identificador inválido.')
    .optional()
    .openapi({ description: 'Só unidades que oferecem o exame.' }),
});

export const specialtyPageSchema = paginatedSchema(specialtySchema);
export const unitPageSchema = paginatedSchema(unitSchema);
export const examTypePageSchema = paginatedSchema(examTypeSchema);

export type CreateSpecialtyInput = z.infer<typeof createSpecialtySchema>;
export type UpdateSpecialtyInput = z.infer<typeof updateSpecialtySchema>;
export type Specialty = z.infer<typeof specialtySchema>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type CreateExamTypeInput = z.infer<typeof createExamTypeSchema>;
export type UpdateExamTypeInput = z.infer<typeof updateExamTypeSchema>;
export type ExamType = z.infer<typeof examTypeSchema>;
export type SaveOfferInput = z.infer<typeof saveOfferSchema>;
export type ExamOffer = z.infer<typeof examOfferSchema>;
export type PolicyInput = z.infer<typeof policyInputSchema>;
export type Policy = z.infer<typeof policySchema>;
