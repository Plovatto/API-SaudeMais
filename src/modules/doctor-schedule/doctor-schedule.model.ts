import '../../docs/zod-extend.js';
import { z } from 'zod';
import { registry } from '../../docs/registry.js';

export const MAX_RANGES_PER_DAY = 12;

const weekday = z.number().int().min(0).max(6).openapi({ description: '0 = domingo, 6 = sábado.', example: 1 });

const rangeSchema = z
  .strictObject({
    startMin: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .openapi({ description: 'Início, em minutos desde 00:00.', example: 480 }),
    endMin: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .openapi({ description: 'Fim, em minutos desde 00:00; 1440 é meia-noite do fim do dia.', example: 720 }),
  })
  .refine((range) => range.startMin < range.endMin, {
    path: ['endMin'],
    message: 'O fim precisa ser depois do início.',
  });

const daySchema = z.strictObject({
  weekday,
  isActive: z.boolean().openapi({ description: 'Dia inativo guarda as faixas, mas não gera vagas.', example: true }),
  ranges: z.array(rangeSchema).max(MAX_RANGES_PER_DAY),
});

export const saveScheduleSchema = registry.register(
  'SaveDoctorScheduleRequest',
  z.strictObject({
    days: z
      .array(daySchema)
      .length(7)
      .refine((days) => new Set(days.map((day) => day.weekday)).size === days.length, 'Informe cada dia uma vez só.')
      .openapi({ description: 'Os 7 dias da semana, cada um uma vez.' }),
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

const warningSchema = z.object({
  appointmentId: z.uuid(),
  startsAt: z.iso.datetime(),
});

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
