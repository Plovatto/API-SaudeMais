import '../../docs/zod-extend.js';
import { z } from 'zod';
import { countSchema } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { civilDay, periodShape, withPeriodRules } from '../doctors/doctors.model.js';

export const MAX_REPORT_DAYS = 366;
export const DEFAULT_REPORT_DAYS = 30;
export const MAX_DAILY_DAYS = 62;
export const TOP_ITEMS = 5;
export const TOP_DOCTORS = 10;

export const reportsQuery = z.strictObject({
  from: civilDay.optional().openapi({
    description: `Primeiro dia, no fuso de São Paulo. Sem ele, ${DEFAULT_REPORT_DAYS - 1} dias antes do último, que por padrão é hoje.`,
    example: '2026-10-22',
  }),
  to: civilDay.optional().openapi({
    description: 'Último dia, incluído, no fuso de São Paulo. Sem ele, hoje.',
    example: '2026-11-20',
  }),
});

export const exportMediaTypes = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

type ExportFormat = keyof typeof exportMediaTypes;

const reportFormats = Object.keys(exportMediaTypes) as [ExportFormat, ...ExportFormat[]];

export const reportExportQuery = reportsQuery.extend({
  format: z.enum(reportFormats).openapi({
    description: 'Formato do arquivo: `pdf` para imprimir ou `xlsx` para abrir em planilha.',
    example: 'pdf',
  }),
});

export const reportPeriod = withPeriodRules(z.object(periodShape), MAX_REPORT_DAYS);

const periodSchema = z.object({
  from: z.iso.date().openapi({ description: 'Primeiro dia, no fuso de São Paulo.', example: '2026-10-22' }),
  to: z.iso.date().openapi({ description: 'Último dia, incluído.', example: '2026-11-20' }),
  granularity: z.enum(['day', 'week']).openapi({
    description: `Tamanho dos intervalos das séries: dia até ${MAX_DAILY_DAYS} dias de período, semana acima disso.`,
    example: 'day',
  }),
});

const statusTotalsShape = {
  total: countSchema('Todos os agendamentos do período.', 140),
  pending: countSchema('Pedidos a confirmar que ainda não começaram.', 6),
  confirmed: countSchema('Confirmados que ainda não começaram.', 30),
  awaitingRecord: countSchema('Confirmados que já começaram e aguardam registro.', 3),
  completed: countSchema('Concluídos.', 80),
  noShow: countSchema('Faltas registradas.', 7),
  cancelled: countSchema('Cancelados.', 12),
  expired: countSchema('Pedidos que não foram confirmados a tempo.', 2),
};

const kindTotalsSchema = z.object({
  ...statusTotalsShape,
  lateCancellations: countSchema('Cancelados pelo paciente dentro da janela de cancelamento tardio.', 4),
  cancelledBy: z
    .object({
      patient: countSchema('Cancelados pelo paciente.', 8),
      doctor: countSchema('Cancelados pelo médico.', 2),
      admin: countSchema('Cancelados por um administrador.', 1),
      system: countSchema('Cancelados pelo sistema, como ao desativar uma conta.', 1),
    })
    .openapi({ description: 'Cancelados por quem cancelou.' }),
});

const rankedSchema = z.object({
  id: z.uuid(),
  name: z.string().openapi({ example: 'Cardiologia' }),
  total: countSchema(
    'Agendamentos do período em qualquer situação, inclusive cancelados e não confirmados a tempo.',
    42,
  ),
});

export const adminReportSchema = registry.register(
  'AdminReport',
  z.object({
    period: periodSchema,
    appointments: kindTotalsSchema
      .extend({
        noShowRate: z.number().min(0).max(1).nullable().openapi({
          description: 'Faltas sobre concluídas mais faltas, de 0 a 1 com três casas; nulo sem nenhuma das duas.',
          example: 0.08,
        }),
      })
      .openapi({ description: 'Consultas do período, pela situação atual.' }),
    exams: kindTotalsSchema.openapi({
      description:
        'Exames do período, pela situação atual. Exames não têm pedido a confirmar nem falta, então esses totais são sempre 0; `awaitingRecord` conta os exames em andamento, que já começaram e ainda não terminaram.',
    }),
    series: z
      .array(
        z.object({
          start: z.iso.date().openapi({ description: 'Primeiro dia do intervalo.', example: '2026-10-22' }),
          ...statusTotalsShape,
        }),
      )
      .openapi({
        description:
          'Consultas e exames por intervalo, pela situação atual, do primeiro ao último dia do período, inclusive os intervalos vazios. As semanas começam no primeiro dia do período; a última pode ser mais curta.',
      }),
    topSpecialties: z.array(rankedSchema).openapi({
      description: `As ${TOP_ITEMS} especialidades com mais consultas no período, em qualquer situação (inclusive canceladas e não confirmadas a tempo), da maior para a menor; empates pelo nome.`,
    }),
    topExamTypes: z.array(rankedSchema).openapi({
      description: `Os ${TOP_ITEMS} tipos de exame com mais agendamentos no período, em qualquer situação (inclusive cancelados), do maior para o menor; empates pelo nome.`,
    }),
  }),
);

const outcomeShape = {
  total: countSchema('Agendamentos do período em qualquer situação.', 42),
  completed: countSchema('Concluídos.', 30),
  noShow: countSchema('Faltas registradas.', 4),
  cancelled: countSchema('Cancelados.', 5),
};

export const adminInsightsSchema = registry.register(
  'AdminInsights',
  z.object({
    period: periodSchema,
    heatmap: z
      .array(
        z.object({
          weekday: z.int().min(1).max(7).openapi({ description: 'Dia da semana ISO: 1 é segunda e 7 é domingo.', example: 2 }),
          hour: z.int().min(0).max(23).openapi({ description: 'Hora cheia do início, no fuso de São Paulo.', example: 9 }),
          total: countSchema('Agendamentos que começam nesse dia da semana e hora.', 12),
        }),
      )
      .openapi({
        description:
          'Agendamentos não cancelados e não expirados do período, por dia da semana e hora de início. Só aparecem as combinações com agendamentos.',
      }),
    leadTime: z
      .object({
        sameDay: countSchema('Marcados com menos de 24 horas de antecedência.', 10),
        upTo3Days: countSchema('Marcados com 24 horas a menos de 3 dias de antecedência.', 20),
        upTo7Days: countSchema('Marcados com 3 a menos de 7 dias de antecedência.', 30),
        upTo14Days: countSchema('Marcados com 7 a menos de 14 dias de antecedência.', 25),
        upTo30Days: countSchema('Marcados com 14 a menos de 30 dias de antecedência.', 15),
        over30Days: countSchema('Marcados com 30 dias ou mais de antecedência.', 5),
        medianHours: z.number().nonnegative().nullable().openapi({
          description: 'Mediana da antecedência em horas, com uma casa; nulo sem agendamentos no período.',
          example: 96.5,
        }),
      })
      .openapi({
        description:
          'Antecedência entre o pedido e o início dos agendamentos do período, em qualquer situação, em faixas.',
      }),
    doctors: z
      .array(z.object({ id: z.uuid(), name: z.string().openapi({ example: 'Dra. Ana Ferreira' }), ...outcomeShape }))
      .openapi({
        description: `Os ${TOP_DOCTORS} médicos com mais consultas no período, em qualquer situação, da maior para a menor; empates pelo nome.`,
      }),
    units: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().openapi({ example: 'Unidade Centro' }),
          ...outcomeShape,
          appointments: countSchema('Consultas do período.', 30),
          exams: countSchema('Exames do período.', 12),
        }),
      )
      .openapi({
        description: 'Todas as unidades com agendamentos no período, da maior para a menor; empates pelo nome.',
      }),
    signups: z
      .object({
        total: countSchema('Contas criadas no período.', 18),
        series: z
          .array(
            z.object({
              start: z.iso.date().openapi({ description: 'Primeiro dia do intervalo.', example: '2026-10-22' }),
              total: countSchema('Contas criadas no intervalo.', 2),
            }),
          )
          .openapi({ description: 'Contas criadas por intervalo, com os mesmos intervalos da série do relatório.' }),
      })
      .openapi({ description: 'Contas novas no período.' }),
    reschedules: z
      .object({
        bookings: countSchema('Agendamentos do período remarcados ao menos uma vez.', 9),
        total: countSchema('Soma das remarcações desses agendamentos.', 11),
      })
      .openapi({ description: 'Remarcações dos agendamentos do período.' }),
  }),
);

export function rateOf(part: number, rest: number): number | null {
  const whole = part + rest;
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;
}

export type ReportsQuery = z.infer<typeof reportsQuery>;
export type ReportExportQuery = z.infer<typeof reportExportQuery>;
export type ReportFormat = ReportExportQuery['format'];
export type AdminReport = z.infer<typeof adminReportSchema>;
export type AdminInsights = z.infer<typeof adminInsightsSchema>;
