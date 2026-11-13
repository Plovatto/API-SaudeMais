import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../docs/registry.js';

const healthResponseSchema = registry.register('HealthResponse', z.object({ status: z.literal('ok') }));

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Sistema'],
  summary: 'Verifica se o servidor está no ar',
  responses: {
    200: { description: 'Servidor no ar', content: { 'application/json': { schema: healthResponseSchema } } },
  },
});

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  return router;
}
