import '../../docs/zod-extend.js';
import { z } from 'zod';
import { registry } from '../../docs/registry.js';

export const adminHomeSchema = registry.register(
  'AdminHome',
  z.object({
    patients: z
      .int()
      .nonnegative()
      .openapi({
        description:
          'Contas ativas com o perfil de paciente, sem as contas de demonstração. Toda conta nasce paciente, então médicos e administradores também entram.',
        example: 127,
      }),
    doctors: z
      .int()
      .nonnegative()
      .openapi({ description: 'Contas ativas com o perfil de médico, sem a conta de demonstração.', example: 61 }),
    appointmentsToday: z.int().nonnegative().openapi({
      description: 'Consultas de hoje no fuso de São Paulo. Fica em 0 até existirem agendamentos.',
      example: 24,
    }),
  }),
);

export type AdminHome = z.infer<typeof adminHomeSchema>;
