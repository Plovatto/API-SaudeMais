import { Router, type RequestHandler } from 'express';
import { forbiddenResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { noStore } from '../../middleware/auth.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import { auditLogPageSchema, auditLogsQuery, DEFAULT_AUDIT_PAGE, MAX_AUDIT_PAGE } from './admin-audit.model.js';
import type { AdminAuditService } from './admin-audit.service.js';

documentOperation({
  method: 'get',
  path: '/api/admin/audit-logs',
  operationId: 'adminListAuditLogs',
  tag: tags.administration.name,
  summary: 'Consultar o registro de auditoria',
  description: `Lista, do mais recente para o mais antigo, o que administradores, integrações e rotinas fizeram: alterações de contas, perfis médicos, catálogo, política, chaves de integração e leitura de resultados. Cada registro traz a conta que agiu (\`actor\`, nulo para rotinas, integrações e contas que não existem mais), a \`action\`, o item afetado e os \`metadata\` com os campos alterados, nunca senhas nem chaves. Filtros: \`from\` e \`to\` (dias no fuso de São Paulo, o último incluído), \`action\` (do catálogo de ações), \`actorId\`, \`entityType\` e \`entityId\`. A paginação é por cursor, estável mesmo com novos registros: envie em \`cursor\` o \`nextCursor\` da resposta anterior até ele vir nulo. Devolve ${DEFAULT_AUDIT_PAGE} registros por padrão e até ${MAX_AUDIT_PAGE} com \`limit\`. Os registros são apagados após o prazo de retenção definido na política (\`auditRetentionDays\`). Limite: 60 requisições por minuto por IP.`,
  query: auditLogsQuery,
  success: { status: 200, description: 'Página de registros de auditoria.', schema: auditLogPageSchema },
  errors: { 403: forbiddenResponse },
});

interface AdminAuditRouterDeps {
  service: AdminAuditService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createAdminAuditRouter({ service, requireAuth, requireAdmin }: AdminAuditRouterDeps): Router {
  const auditLimit = limitRequests(60);
  const adminOnly = [noStore, requireAuth, requireAdmin];
  const router = Router();
  router.get('/api/admin/audit-logs', auditLimit, ...adminOnly, (async (req, res) => {
    res.json(await service.page(auditLogsQuery.parse(req.query)));
  }) satisfies RequestHandler);
  return router;
}
