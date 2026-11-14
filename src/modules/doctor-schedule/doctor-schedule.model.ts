import '../../docs/zod-extend.js';
import { z } from 'zod';
import { registry } from '../../docs/registry.js';
import { endMinute, endsAfterStart, startMinute, weekday, weekList } from '../../lib/week.js';

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

export const saveScheduleSchema = registry.register(
  'SaveDoctorScheduleRequest',
  z.strictObject({
    days: weekList(daySchema).length(7).openapi({ description: 'Os 7 dias da semana, cada um uma vez.' }),
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

export const scheduleSchema = registry.register(
  'DoctorSchedule',
  z.object({
    days: z.array(daySchema).openapi({ description: 'Os 7 dias, de domingo a sábado, com as faixas em ordem.' }),
    unitHours: z
      .array(unitHourSchema)
      .openapi({ description: 'Horário da unidade do médico; as faixas precisam caber nele. Dias ausentes: fechada.' }),
  }),
);

export type Schedule = z.infer<typeof scheduleSchema>;

export const savedScheduleSchema = registry.register(
  'SavedDoctorSchedule',
  scheduleSchema.extend({
    warnings: z.array(z.object({ appointmentId: z.uuid(), startsAt: z.iso.datetime() })).openapi({
      description:
        'Consultas futuras que ficaram fora das novas faixas. Nada é cancelado: o médico decide o que fazer com cada uma.',
    }),
  }),
);

export type SavedSchedule = z.infer<typeof savedScheduleSchema>;
