import '../../docs/zod-extend.js';
import { z } from 'zod';
import { APPOINTMENT_DURATIONS } from '../../database/schema/doctor-profiles.js';
import { MAX_TIME_OFF_REASON } from '../../database/schema/doctor-schedule.js';
import { registry } from '../../docs/registry.js';
import { endMinute, endsAfterStart, startMinute, weekday, weekList } from '../../lib/week.js';
import { civilDay } from '../doctors/doctors.model.js';

export const MAX_RANGES_PER_DAY = 12;

const rangeSchema = endsAfterStart(
  z.strictObject({
    startMin: startMinute.openapi({ description: 'Início, em minutos desde 00:00.', example: 480 }),
    endMin: endMinute.openapi({
      description: 'Fim, em minutos desde 00:00; 1440 é meia-noite do fim do dia.',
      example: 720,
    }),
  }),
  'startMin',
  'endMin',
  'O fim precisa ser depois do início.',
);

const daySchema = z.strictObject({
  weekday,
  isActive: z.boolean().openapi({ description: 'Dia inativo guarda as faixas, mas não gera vagas.', example: true }),
  ranges: z.array(rangeSchema).max(MAX_RANGES_PER_DAY),
});

const durationChoice = z.literal(APPOINTMENT_DURATIONS, 'Escolha 15, 20, 30, 45 ou 60 minutos.');

export const saveScheduleSchema = registry.register(
  'SaveDoctorScheduleRequest',
  z.strictObject({
    days: weekList(daySchema).length(7).openapi({ description: 'Os 7 dias da semana, cada um uma vez.' }),
    appointmentDurationMin: durationChoice.nullable().optional().openapi({
      description:
        'Duração de cada consulta do médico, em minutos: 15, 20, 30, 45 ou 60. `null` volta para a duração padrão da especialidade; sem o campo, a duração atual fica como está.',
      example: 30,
    }),
  }),
);

export type SaveScheduleInput = z.infer<typeof saveScheduleSchema>;
export type ScheduleDay = SaveScheduleInput['days'][number];

const unitHourSchema = z.object({
  weekday,
  openMin: z.int().openapi({ example: 420 }),
  closeMin: z.int().openapi({ example: 1140 }),
});

export type UnitHour = z.infer<typeof unitHourSchema>;

export const durationSchema = z.object({
  appointmentDurationMin: z.int().openapi({
    description: 'Duração de cada consulta, em minutos, usada nas vagas e nos novos agendamentos.',
    example: 30,
  }),
  specialtyDurationMin: z.int().openapi({ description: 'Duração padrão da especialidade do médico.', example: 30 }),
  isSpecialtyDefault: z.boolean().openapi({
    description: 'Verdadeiro quando o médico não escolheu uma duração própria e vale a da especialidade.',
    example: true,
  }),
});

export type Duration = z.infer<typeof durationSchema>;

export const scheduleSchema = registry.register(
  'DoctorSchedule',
  durationSchema.extend({
    days: z.array(daySchema).openapi({ description: 'Os 7 dias, de domingo a sábado, com as faixas em ordem.' }),
    unitHours: z
      .array(unitHourSchema)
      .openapi({ description: 'Horário da unidade do médico; as faixas precisam caber nele. Dias ausentes: fechada.' }),
  }),
);

export type Schedule = z.infer<typeof scheduleSchema>;

const warningSchema = registry.register(
  'ScheduleWarning',
  z.object({
    appointmentId: z.uuid(),
    startsAt: z.iso.datetime().openapi({ example: '2026-11-23T12:00:00.000Z' }),
  }),
);

export type ScheduleWarning = z.infer<typeof warningSchema>;

export const savedScheduleSchema = registry.register(
  'SavedDoctorSchedule',
  scheduleSchema.extend({
    warnings: z.array(warningSchema).openapi({
      description:
        'Consultas futuras que ficaram fora das novas faixas. Nada é cancelado: o médico decide o que fazer com cada uma.',
    }),
  }),
);

export type SavedSchedule = z.infer<typeof savedScheduleSchema>;

const timeOffDate = civilDay.openapi({ description: 'Dia bloqueado, no fuso de São Paulo.', example: '2026-12-24' });

export const timeOffParams = z.strictObject({ date: timeOffDate });

export const createTimeOffSchema = registry.register(
  'CreateDoctorTimeOffRequest',
  z.strictObject({
    date: timeOffDate,
    reason: z
      .string()
      .trim()
      .max(MAX_TIME_OFF_REASON, `Use no máximo ${MAX_TIME_OFF_REASON} caracteres.`)
      .optional()
      .openapi({ description: 'Motivo opcional, visível só para o médico.', example: 'Congresso de cardiologia' }),
  }),
);

export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;

export const timeOffSchema = registry.register(
  'DoctorTimeOff',
  z.object({
    date: timeOffDate,
    reason: z.string().nullable().openapi({ example: 'Congresso de cardiologia' }),
  }),
);

export type TimeOff = z.infer<typeof timeOffSchema>;

export const createdTimeOffSchema = registry.register(
  'CreatedDoctorTimeOff',
  timeOffSchema.extend({
    warnings: z.array(warningSchema).openapi({
      description:
        'Consultas pendentes ou confirmadas que já estavam marcadas no dia. Nada é cancelado: o médico decide o que fazer com cada uma.',
    }),
  }),
);

export type CreatedTimeOff = z.infer<typeof createdTimeOffSchema>;
