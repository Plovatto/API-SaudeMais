import '../../docs/zod-extend.js';
import { z } from 'zod';
import { roles } from '../../database/schema/users.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/params.js';
import { publicUserSchema } from '../users/user.model.js';

const ufs = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;

export const usersQuery = paginationQuery.extend({
  search: z
    .string()
    .trim()
    .max(120, 'A busca pode ter até 120 caracteres.')
    .optional()
    .openapi({ description: 'Parte do nome (sem distinguir acentos nem maiúsculas) ou do e-mail.' }),
  role: z.enum(roles).optional().openapi({ description: 'Só contas com este perfil.' }),
  status: z.enum(['active', 'inactive']).optional().openapi({ description: 'Só contas ativas ou só desativadas.' }),
});

export const roleParams = z.strictObject({
  id: uuidParam,
  role: z.literal('admin', { error: 'Por esta rota só se concede o perfil de administrador.' }),
});

const registryNumber = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,9}$/, 'Informe o número do registro só com dígitos, sem zeros à esquerda.')
  .openapi({ example: '123456' });

const registryUf = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(ufs, { error: 'Informe a UF do registro.' }))
  .openapi({ example: 'SP' });

export const doctorProfileInputSchema = registry.register(
  'DoctorProfileInput',
  z.strictObject({ specialtyId: uuidParam, unitId: uuidParam, registryNumber, registryUf }),
);

export const updateDoctorProfileSchema = registry.register(
  'UpdateDoctorProfileInput',
  z
    .strictObject({
      specialtyId: uuidParam.optional(),
      unitId: uuidParam.optional(),
      registryNumber: registryNumber.optional(),
      registryUf: registryUf.optional(),
    })
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
      path: ['_root'],
      message: 'Envie ao menos um campo.',
    }),
);

export const doctorProfileSchema = registry.register(
  'DoctorProfile',
  z.object({
    specialtyId: z.uuid(),
    specialtyName: z.string().openapi({ example: 'Cardiologia' }),
    council: z.string().openapi({ example: 'CRM' }),
    unitId: z.uuid(),
    unitName: z.string().openapi({ example: 'Unidade Central' }),
    registryNumber: z.string().openapi({ example: '123456' }),
    registryUf: z.string().openapi({ example: 'SP' }),
  }),
);

export const adminUserSchema = registry.register(
  'AdminUser',
  publicUserSchema.extend({
    isProtected: z.boolean().openapi({ description: 'Conta de demonstração, que não pode ser alterada.' }),
    deactivatedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

export const adminUserDetailSchema = registry.register(
  'AdminUserDetail',
  adminUserSchema.extend({ doctorProfile: doctorProfileSchema.nullable() }),
);

export const adminUserPageSchema = registry.register('AdminUserPage', paginatedSchema(adminUserSchema));

export const deactivationImpactSchema = registry.register(
  'DeactivationImpact',
  z.object({
    futureAppointmentsAsPatient: z.number().int().openapi({ description: 'Consultas e exames futuros da pessoa.' }),
    futureAppointmentsAsDoctor: z.number().int().openapi({ description: 'Consultas futuras que ela atende.' }),
  }),
);

export type UsersQuery = z.infer<typeof usersQuery>;
export type DoctorProfileInput = z.infer<typeof doctorProfileInputSchema>;
export type UpdateDoctorProfileInput = z.infer<typeof updateDoctorProfileSchema>;
export type DoctorProfile = z.infer<typeof doctorProfileSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
export type DeactivationImpact = z.infer<typeof deactivationImpactSchema>;
