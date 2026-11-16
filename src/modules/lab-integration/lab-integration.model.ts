import '../../docs/zod-extend.js';
import { z } from 'zod';
import { resultFlags, resultStatuses } from '../../database/schema/exam-results.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema } from '../../lib/pagination.js';
import { boundedText } from '../../lib/text.js';
import { instant } from '../appointments/appointments.model.js';
import { examTypeSchema } from '../catalog/catalog.model.js';
import { civilDay } from '../doctors/doctors.model.js';
import { PUBLIC_CODE_PATTERN } from '../exam-bookings/exam-bookings.model.js';

const resultOutcomes = ['created', 'unchanged', 'amended'] as const;

const examCode = z
  .string()
  .regex(PUBLIC_CODE_PATTERN, 'Use o código do exame recebido na worklist.')
  .openapi({ description: 'Código público do exame.', example: 'EX-7F3K2Q' });

export const createClientSchema = registry.register(
  'CreateIntegrationClientRequest',
  z.strictObject({ name: boundedText('O nome', 2, 80).openapi({ example: 'Laboratório Central' }) }),
);

export const integrationClientSchema = registry.register(
  'IntegrationClient',
  z.object({
    id: z.uuid(),
    name: z.string().openapi({ example: 'Laboratório Central' }),
    keyPrefix: z.string().openapi({
      description: 'Começo visível da chave, para identificá-la sem expor o segredo.',
      example: '7f3k2q9a',
    }),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso
      .datetime()
      .nullable()
      .openapi({ description: 'Último uso da chave, atualizado no máximo a cada 5 minutos.' }),
    revokedAt: z.iso.datetime().nullable().openapi({ description: 'Quando a chave foi revogada; nulo se ativa.' }),
  }),
);

export const createdClientSchema = registry.register(
  'CreatedIntegrationClient',
  integrationClientSchema.extend({
    apiKey: z.string().openapi({
      description:
        'Chave completa, para o cabeçalho `X-Api-Key`. Só aparece nesta resposta; a API guarda apenas o hash.',
      example: 'slab_7f3k2q9a_q3Zp1vQx8n0rT2bYc4dEf6gHi8jKl0mNo2pQr4sTu6v',
    }),
  }),
);

export const clientPageSchema = paginatedSchema(integrationClientSchema);

export const worklistQuery = z.strictObject({
  date: civilDay.openapi({ description: 'Dia dos exames, no fuso de São Paulo.', example: '2026-11-23' }),
});

export const worklistSchema = registry.register(
  'LabWorklist',
  z.array(
    z.object({
      examCode,
      examTypeCode: examTypeSchema.shape.code,
      startsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:00:00.000Z' }),
    }),
  ),
);

export const resultItemSchema = z.strictObject({
  name: boundedText('O nome do item', 1, 80).openapi({ example: 'Hemoglobina' }),
  value: z
    .union([z.number(), boundedText('O valor', 1, 40)])
    .openapi({ description: 'Número ou texto, como `Negativo`.', example: 13.8 }),
  unit: boundedText('A unidade', 1, 20).nullable().default(null).openapi({ example: 'g/dL' }),
  referenceRange: boundedText('A faixa de referência', 1, 60)
    .nullable()
    .default(null)
    .openapi({ example: '12,0 a 16,0' }),
  flag: z.enum(resultFlags).openapi({ description: 'Indicador do valor em relação à faixa de referência.' }),
});

export const resultInputSchema = registry.register(
  'LabResultRequest',
  z
    .strictObject({
      externalId: boundedText('O externalId', 1, 64).openapi({
        description: 'Identificador do resultado no laboratório; o mesmo em reenvios e retificações.',
        example: 'LAB-2026-000123',
      }),
      examCode,
      status: z.enum(resultStatuses).openapi({
        description: '`final` na primeira publicação; `amended` para retificar o conteúdo já publicado.',
      }),
      issuedAt: instant('Envie a data de emissão em ISO 8601.', 'Emissão do resultado no laboratório.'),
      items: z
        .array(resultItemSchema)
        .min(1, 'Envie pelo menos um item.')
        .max(50, 'Envie no máximo 50 itens.')
        .optional()
        .openapi({ description: 'Itens do exame laboratorial.' }),
      report: boundedText('O laudo', 1, 10000, { multiline: true })
        .optional()
        .openapi({ description: 'Laudo em texto do exame de imagem.', example: 'Fígado de dimensões normais.' }),
    })
    .refine(({ items, report }) => (items === undefined) !== (report === undefined), {
      path: ['items'],
      message: 'Envie itens, no exame laboratorial, ou laudo, no exame de imagem.',
    }),
);

export const resultReceiptSchema = registry.register(
  'LabResultReceipt',
  z.object({
    examCode,
    externalId: z.string().openapi({ example: 'LAB-2026-000123' }),
    version: z.int().positive().openapi({ description: 'Versão atual do resultado.', example: 1 }),
    outcome: z.enum(resultOutcomes).openapi({
      description:
        '`created` na primeira publicação, `unchanged` no reenvio de conteúdo igual ao atual e `amended` quando a retificação criou uma versão.',
    }),
  }),
);

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type IntegrationClient = z.infer<typeof integrationClientSchema>;
export type CreatedClient = z.infer<typeof createdClientSchema>;
export type Worklist = z.infer<typeof worklistSchema>;
export type ResultInput = z.infer<typeof resultInputSchema>;
export type ResultReceipt = z.infer<typeof resultReceiptSchema>;
