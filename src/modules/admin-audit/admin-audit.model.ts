import '../../docs/zod-extend.js';
import { z } from 'zod';
import { actorTypes, auditActions } from '../../database/schema/audit-logs.js';
import { nullableRef } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { uuidParam } from '../../lib/params.js';
import { civilDay, endNotBeforeStart } from '../doctors/doctors.model.js';

const entityNeedsType = {
  path: ['entityType'],
  message: 'Informe o tipo do item junto com o item.',
};

export const DEFAULT_AUDIT_PAGE = 30;
export const MAX_AUDIT_PAGE = 100;

export const auditLogsQuery = z
  .strictObject({
    from: civilDay.optional().openapi({
      description: 'Primeiro dia, no fuso de São Paulo.',
      example: '2026-11-01',
    }),
    to: civilDay.optional().openapi({
      description: 'Último dia, incluído, no fuso de São Paulo.',
      example: '2026-11-27',
    }),
    action: z.enum(auditActions).optional().openapi({
      description: 'Só registros desta ação, entre as do catálogo.',
      example: 'user.deactivated',
    }),
    actorId: uuidParam.optional().openapi({ description: 'Só ações feitas por esta conta.' }),
    entityType: z.string().trim().min(1).max(40).optional().openapi({
      description: 'Só registros deste tipo de item, como `user`, `unit` ou `settings`.',
      example: 'user',
    }),
    entityId: z.string().trim().min(1).max(64).optional().openapi({
      description: 'Só registros deste item. Exige `entityType`.',
      example: '0190a5d2-7c1e-7b3a-9f4d-2e8b6c1a5f30',
    }),
    cursor: uuidParam.optional().openapi({
      description: 'O `nextCursor` da resposta anterior, para buscar os registros mais antigos.',
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_AUDIT_PAGE)
      .default(DEFAULT_AUDIT_PAGE)
      .openapi({ description: `Quantos registros por resposta, de 1 a ${MAX_AUDIT_PAGE}.`, example: DEFAULT_AUDIT_PAGE }),
  })
  .refine(({ from, to }) => !from || !to || to >= from, endNotBeforeStart)
  .refine(({ entityId, entityType }) => !entityId || entityType !== undefined, entityNeedsType);

export type AuditLogsQuery = z.infer<typeof auditLogsQuery>;

const actorSchema = z.object({
  id: z.uuid(),
  fullName: z.string().openapi({ example: 'Marina Costa' }),
  email: z.string().openapi({ example: 'marina.costa@email.com' }),
});

const auditLogSchema = registry.register(
  'AuditLog',
  z.object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    actorType: z.enum(actorTypes).openapi({
      description: '`user` para contas, `integration` para sistemas externos e `system` para rotinas automáticas.',
    }),
    actor: nullableRef(actorSchema).openapi({
      description: 'Conta que agiu. Nulo para rotinas automáticas, integrações e contas que não existem mais.',
    }),
    action: z
      .string()
      .openapi({ description: 'Ação registrada, como `user.deactivated`.', example: 'user.deactivated' }),
    entityType: z.string().nullable().openapi({ example: 'user' }),
    entityId: z.string().nullable().openapi({ example: '0190a5d2-7c1e-7b3a-9f4d-2e8b6c1a5f30' }),
    metadata: z
      .record(z.string(), z.unknown())
      .openapi({ description: 'Detalhes da ação, como os campos alterados. Nunca guarda senhas nem chaves.' }),
    ip: z.string().nullable().openapi({ example: '203.0.113.7' }),
  }),
);

export const auditLogPageSchema = registry.register(
  'AuditLogPage',
  z.object({
    items: z.array(auditLogSchema),
    nextCursor: z.uuid().nullable().openapi({
      description: 'Envie em `cursor` para buscar os registros seguintes. Nulo quando não há mais.',
    }),
  }),
);

export type AuditLog = z.infer<typeof auditLogSchema>;
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
