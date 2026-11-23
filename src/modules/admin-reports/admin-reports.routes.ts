import { Router, type RequestHandler } from 'express';
import { forbiddenResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { noStore } from '../../middleware/auth.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import {
  adminReportSchema,
  DEFAULT_REPORT_DAYS,
  exportMediaTypes,
  MAX_REPORT_DAYS,
  reportExportQuery,
  reportsQuery,
} from './admin-reports.model.js';
import type { AdminReportsService } from './admin-reports.service.js';

documentOperation({
  method: 'get',
  path: '/api/admin/reports',
  operationId: 'getAdminReports',
  tag: tags.administration.name,
  summary: 'Ver os relatórios',
  description: `Totais de consultas e exames que começam no período, pela situação atual, com cancelamentos por autor, taxa de faltas, série para gráfico e especialidades e exames mais procurados. Os dias seguem o fuso de São Paulo; sem datas, vale os últimos ${DEFAULT_REPORT_DAYS} dias até hoje, e o período tem no máximo ${MAX_REPORT_DAYS} dias. Só números: nada de dados pessoais, observações, motivos ou resultados. Limite: 30 requisições por minuto por IP.`,
  query: reportsQuery,
  success: { status: 200, description: 'Relatório do período.', schema: adminReportSchema },
  errors: { 403: forbiddenResponse },
});

documentOperation({
  method: 'get',
  path: '/api/admin/reports/export',
  operationId: 'exportAdminReport',
  tag: tags.administration.name,
  summary: 'Exportar os relatórios',
  description: `Gera o mesmo relatório de \`GET /api/admin/reports\`, com os mesmos períodos e regras, como arquivo para baixar: \`pdf\` para imprimir (resumo de consultas e exames, série por dia ou semana e especialidades e exames mais procurados) ou \`xlsx\` para abrir em planilha (abas Resumo, Série, Especialidades e Exames, com números, datas e percentuais de verdade). Responde como anexo (\`Content-Disposition: attachment; filename=relatorio_<início>_a_<fim>.<formato>\`). Só números, sem dados pessoais. Limite: 20 arquivos por minuto por IP.`,
  query: reportExportQuery,
  success: {
    status: 200,
    description: 'Relatório no formato pedido.',
    file: {
      mediaTypes: [exportMediaTypes.pdf, exportMediaTypes.xlsx],
      disposition: 'Sempre `attachment`, com o nome `relatorio_<primeiro dia>_a_<último dia>.<pdf ou xlsx>`.',
      example: 'attachment; filename=relatorio_2026-10-22_a_2026-11-20.pdf',
    },
  },
  errors: { 403: forbiddenResponse },
});

interface AdminReportsRouterDeps {
  service: AdminReportsService;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createAdminReportsRouter({ service, requireAuth, requireAdmin }: AdminReportsRouterDeps): Router {
  const reportsLimit = limitRequests(30);
  const report: RequestHandler = async (req, res) => {
    res.json(await service.report(reportsQuery.parse(req.query)));
  };
  const exportLimit = limitRequests(20);
  const exportReport: RequestHandler = async (req, res) => {
    const { fileName, content } = await service.export(reportExportQuery.parse(req.query));
    res.attachment(fileName).send(content);
  };
  const router = Router();
  router.get('/api/admin/reports', reportsLimit, noStore, requireAuth, requireAdmin, report);
  router.get('/api/admin/reports/export', exportLimit, noStore, requireAuth, requireAdmin, exportReport);
  return router;
}
