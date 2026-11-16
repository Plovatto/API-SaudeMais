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

const versionSchema = z.object({
  version: z.int().positive().openapi({ example: 2 }),
  status: z
    .enum(resultStatuses)
    .openapi({ description: '`final` na primeira publicação; `amended` nas retificações.' }),
  issuedAt: z.iso.datetime().openapi({ description: 'Emissão no laboratório.' }),
  receivedAt: z.iso.datetime().openapi({ description: 'Recebimento pela API.' }),
  items: z
    .array(resultItemSchema)
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

export type ExamResult = z.infer<typeof examResultSchema>;
export type ExamResultVersion = z.infer<typeof versionSchema>;
