import '../../docs/zod-extend.js';
import { z } from 'zod';
import { registry } from '../../docs/registry.js';

export const adminHomeSchema = registry.register(
  'AdminHome',
  z.object({
    patients: z.int().nonnegative().openapi({ description: 'Contas ativas com o perfil de paciente.', example: 127 }),
    doctors: z.int().nonnegative().openapi({ description: 'Contas ativas com o perfil de médico.', example: 61 }),
    appointmentsToday: z.int().nonnegative().openapi({
      description: 'Consultas de hoje no fuso de São Paulo. Fica em 0 até existirem agendamentos.',
      example: 24,
    }),
  }),
);

export type AdminHome = z.infer<typeof adminHomeSchema>;
