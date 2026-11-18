import '../../docs/zod-extend.js';
import { z } from 'zod';
import { countSchema } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';

export const adminHomeSchema = registry.register(
  'AdminHome',
  z.object({
    patients: z.int().nonnegative().openapi({
      description:
        'Contas ativas com o perfil de paciente. Toda conta nasce paciente, então médicos e administradores também entram.',
      example: 127,
    }),
    doctors: z.int().nonnegative().openapi({ description: 'Contas ativas com o perfil de médico.', example: 61 }),
    appointmentsToday: countSchema(
      'Consultas que começam hoje no fuso de São Paulo pendentes, confirmadas, concluídas ou com falta registrada, sem as canceladas, e as não confirmadas a tempo.',
      24,
    ),
  }),
);

export type AdminHome = z.infer<typeof adminHomeSchema>;
