import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { forbiddenResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { adminReportSchema, DEFAULT_REPORT_DAYS, MAX_REPORT_DAYS, reportsQuery } from './admin-reports.model.js';
import type { AdminReportsService } from './admin-reports.service.js';

documentOperation({
  method: 'get',
  path: '/api/admin/reports',
  operationId: 'getAdminReports',
  tag: tags.administration.name,
  summary: 'Ver os relatórios',
  description: `Totais de consultas e exames que começam no período, pela situação atual, com cancelamentos por autor, taxa de faltas, série para gráfico e especialidades e exames mais procurados. Os dias seguem o fuso de São Paulo; sem datas, vale os últimos ${DEFAULT_REPORT_DAYS} dias até hoje, e o período tem no máximo ${MAX_REPORT_DAYS} dias. Só números: nada de dados pessoais, observações, motivos ou resultados. Agendamentos de pacientes de demonstração não entram. Limite: 30 requisições por minuto por IP.`,
  query: reportsQuery,
  success: { status: 200, description: 'Relatório do período.', schema: adminReportSchema },
  errors: { 403: forbiddenResponse },
});

export interface AdminReportsRouterDeps {
  service: AdminReportsService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createAdminReportsRouter({ service, requireAuth, requireAdmin }: AdminReportsRouterDeps): Router {
  const reportsLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 30 });
  const report: RequestHandler = async (req, res) => {
    res.json(await service.report(reportsQuery.parse(req.query)));
  };
  const router = Router();
  router.get('/api/admin/reports', reportsLimit, noStore, requireAuth, requireAdmin, report);
  return router;
}
