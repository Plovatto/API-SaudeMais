import { Router, type RequestHandler } from 'express';
import { forbiddenResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { noStore } from '../../middleware/auth.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import { adminHomeSchema } from './admin-home.model.js';
import type { AdminHomeService } from './admin-home.service.js';

documentOperation({
  method: 'get',
  path: '/api/admin/home',
  operationId: 'getAdminHome',
  tag: tags.administration.name,
  summary: 'Ver os números do painel',
  description:
    'Contagens do painel do administrador: pacientes e médicos com conta ativa e consultas de hoje no fuso de São Paulo. Contas desativadas não entram. Limite: 120 requisições por minuto por IP.',
  success: { status: 200, description: 'Números do painel.', schema: adminHomeSchema },
  errors: { 403: forbiddenResponse },
});

interface AdminHomeRouterDeps {
  service: AdminHomeService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createAdminHomeRouter({ service, requireAuth, requireAdmin }: AdminHomeRouterDeps): Router {
  const homeLimit = limitRequests(120);
  const summary: RequestHandler = async (_req, res) => {
    res.json(await service.summary());
  };
  const router = Router();
  router.get('/api/admin/home', homeLimit, noStore, requireAuth, requireAdmin, summary);
  return router;
}
