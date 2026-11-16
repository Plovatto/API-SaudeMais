import '../../docs/zod-extend.js';
import { z } from 'zod';
import { countSchema } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { civilDay, periodShape, withPeriodRules } from '../doctors/doctors.model.js';

export const MAX_REPORT_DAYS = 366;
export const DEFAULT_REPORT_DAYS = 30;
export const MAX_DAILY_DAYS = 62;
export const TOP_ITEMS = 5;

export const reportsQuery = z.strictObject({
  from: civilDay.optional().openapi({
    description: `Primeiro dia, no fuso de São Paulo. Sem ele, ${DEFAULT_REPORT_DAYS - 1} dias antes do último.`,
    example: '2026-10-22',
  }),
  to: civilDay.optional().openapi({
    description: 'Último dia, incluído, no fuso de São Paulo. Sem ele, hoje.',
    example: '2026-11-20',
  }),
});

export const reportPeriod = withPeriodRules(z.object(periodShape), MAX_REPORT_DAYS);

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
  total: countSchema('Agendamentos do período.', 42),
});

export const adminReportSchema = registry.register(
  'AdminReport',
  z.object({
    period: z.object({
      from: z.iso.date().openapi({ description: 'Primeiro dia, no fuso de São Paulo.', example: '2026-10-22' }),
      to: z.iso.date().openapi({ description: 'Último dia, incluído.', example: '2026-11-20' }),
      granularity: z.enum(['day', 'week']).openapi({
        description: `Tamanho dos intervalos da série: dia até ${MAX_DAILY_DAYS} dias de período, semana acima disso.`,
        example: 'day',
      }),
    }),
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
        'Exames do período, pela situação atual. Exames não têm pedido a confirmar nem falta, então esses totais são sempre 0.',
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
      description: `As ${TOP_ITEMS} especialidades com mais consultas no período, da maior para a menor; empates pelo nome.`,
    }),
    topExamTypes: z.array(rankedSchema).openapi({
      description: `Os ${TOP_ITEMS} tipos de exame com mais agendamentos no período, do maior para o menor; empates pelo nome.`,
    }),
  }),
);

export type ReportsQuery = z.infer<typeof reportsQuery>;
export type AdminReport = z.infer<typeof adminReportSchema>;
