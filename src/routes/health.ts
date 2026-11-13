import { Router } from 'express';
import { z } from 'zod';
import { internalErrorResponse } from '../docs/common-schemas.js';
import { registry } from '../docs/registry.js';
import { tags } from '../docs/tags.js';

const healthResponseSchema = registry.register(
  'HealthResponse',
  z.object({ status: z.literal('ok') }).openapi({ example: { status: 'ok' } }),
);

registry.registerPath({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tags: [tags.system.name],
  summary: 'Verificar se o servidor está no ar',
  description:
    'Responde sem consultar o banco, para que verificações periódicas não acordem o banco de dados quando ele está desligado por inatividade.',
  responses: {
    200: { description: 'Servidor no ar.', content: { 'application/json': { schema: healthResponseSchema } } },
    500: internalErrorResponse,
  },
});

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return router;
}
