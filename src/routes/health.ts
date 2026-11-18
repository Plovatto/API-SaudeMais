import { Router } from 'express';
import { z } from 'zod';
import { documentOperation } from '../docs/operation.js';
import { publicSecurity, registry } from '../docs/registry.js';
import { tags } from '../docs/tags.js';

const healthResponseSchema = registry.register(
  'HealthResponse',
  z.object({ status: z.literal('ok') }).openapi({ example: { status: 'ok' } }),
);

documentOperation({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tag: tags.system.name,
  summary: 'Verificar se o servidor está no ar',
  description:
    'Responde sem consultar o banco, para que verificações periódicas não acordem o banco de dados quando ele está desligado por inatividade.',
  auth: publicSecurity,
  rateLimited: false,
  success: { status: 200, description: 'Servidor no ar.', schema: healthResponseSchema },
});

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return router;
}
