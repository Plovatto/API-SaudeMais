import '../../docs/zod-extend.js';
import { z } from 'zod';
import { resultStatuses } from '../../database/schema/exam-results.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/params.js';
import { examTypeSchema } from '../catalog/catalog.model.js';
import { doctorSchema } from '../doctors/doctors.model.js';
import { resultItemSchema } from '../lab-integration/lab-integration.model.js';

export const bookingParams = z.strictObject({ bookingId: uuidParam });

export const patientParams = z.strictObject({ patientId: uuidParam });

const itemViewSchema = resultItemSchema.extend({
  range: z
    .object({ low: z.number(), high: z.number() })
    .nullable()
    .openapi({
      description: 'Faixa numérica lida de `referenceRange`; nula quando a referência não é um intervalo "mínimo a máximo".',
      example: { low: 12, high: 16 },
    }),
  about: z.string().nullable().openapi({
    description: 'Explicação em linguagem simples do que o item mede; nula quando o item não está no glossário.',
    example: 'Proteína dentro dos glóbulos vermelhos que carrega o oxigênio. Quando está baixa, pode indicar anemia.',
  }),
});

const versionSchema = z.object({
  version: z.int().positive().openapi({ example: 2 }),
  status: z
    .enum(resultStatuses)
    .openapi({ description: '`final` na primeira publicação; `amended` nas retificações.' }),
  issuedAt: z.iso.datetime().openapi({ description: 'Emissão no laboratório.' }),
  receivedAt: z.iso.datetime().openapi({ description: 'Recebimento pela API.' }),
  items: z
    .array(itemViewSchema)
    .nullable()
    .openapi({ description: 'Itens do exame laboratorial, com o indicador de cada valor; nulo em exame de imagem.' }),
  report: z
    .string()
    .nullable()
    .openapi({ description: 'Laudo do exame de imagem; nulo em exame laboratorial.', example: null }),
});

export const examResultSchema = registry.register(
  'ExamResult',
  z.object({
    booking: z.object({
      id: z.uuid(),
      publicCode: z.string().openapi({ example: 'EX-7F3K2Q' }),
      examType: examTypeSchema.pick({ id: true, name: true, kind: true }),
      unit: doctorSchema.shape.unit,
      startsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:00:00.000Z' }),
    }),
    current: versionSchema.openapi({ description: 'Versão atual: a de maior número.' }),
    previous: z.array(versionSchema).openapi({
      description: 'Versões anteriores, imutáveis, da mais nova para a mais antiga; vazia sem retificação.',
    }),
  }),
);

export const examResultPageSchema = registry.register('ExamResultPage', paginatedSchema(examResultSchema));

const examResultSummarySchema = registry.register(
  'ExamResultSummary',
  z.object({
    bookingId: z.uuid(),
    examType: examTypeSchema.pick({ id: true, name: true, kind: true }),
    startsAt: z.iso.datetime().openapi({ description: 'Início do exame.', example: '2026-11-04T11:00:00.000Z' }),
    issuedAt: z.iso.datetime().openapi({ description: 'Emissão da versão atual no laboratório.' }),
    amended: z.boolean().openapi({ description: 'Se a versão atual é uma retificação.' }),
    summary: z
      .object({
        items: z.int().nonnegative().openapi({ example: 8 }),
        outOfRange: z.int().nonnegative().openapi({ description: 'Itens com indicador diferente de `normal`.', example: 2 }),
        flagged: z
          .array(z.string())
          .openapi({ description: 'Nomes dos itens fora da referência, na ordem do laudo.', example: ['Hematócrito', 'Leucócitos'] }),
      })
      .nullable()
      .openapi({ description: 'Contagem dos itens da versão atual; nula em exame de imagem.' }),
  }),
);

export const examResultSummaryPageSchema = registry.register(
  'ExamResultSummaryPage',
  paginatedSchema(examResultSummarySchema),
);

export type ExamResult = z.infer<typeof examResultSchema>;
export type ExamResultVersion = z.infer<typeof versionSchema>;
export type ExamResultSummary = z.infer<typeof examResultSummarySchema>;
export type ResultItemView = z.infer<typeof itemViewSchema>;
