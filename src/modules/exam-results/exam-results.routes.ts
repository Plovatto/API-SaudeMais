import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  errorResponse,
  forbiddenResponse,
  internalErrorResponse,
  notFoundResponse,
  tooManyRequestsResponse,
  unauthenticatedResponse,
  validationErrorResponse,
} from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { registry, sessionSecurity } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { paginationQuery } from '../../lib/pagination.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { ExamResultsController } from './exam-results.controller.js';
import { noExamReview, resultNotFound } from './exam-results.messages.js';
import {
  bookingParams,
  examResultPageSchema,
  examResultSchema,
  examResultSummaryPageSchema,
  patientParams,
} from './exam-results.model.js';

const patientPath = '/api/patient/exam-results';
const doctorPath = '/api/doctor/patients';
const auditNote =
  'Cada resultado devolvido fica na auditoria como `exam_result.read`, só com o exame e a versão atual, nunca com o conteúdo. Limite: 120 requisições por minuto por IP.';

documentOperation({
  method: 'get',
  path: patientPath,
  operationId: 'listPatientExamResults',
  tag: tags.patient.name,
  summary: 'Listar os resultados de exame',
  description: `Resultados de exame do paciente logado, do exame mais recente para o mais antigo, cada um com o tipo de exame, as datas e um resumo da versão atual: quantos itens há e quais estão fora da referência (indicador diferente de \`normal\`). Exame de imagem vem com \`summary\` nulo. Para os itens, o laudo e as versões anteriores, use \`GET ${patientPath}/{bookingId}\`. ${auditNote}`,
  query: paginationQuery,
  success: { status: 200, description: 'Página de resultados do paciente.', schema: examResultSummaryPageSchema },
  errors: { 403: forbiddenResponse },
});

registry.registerPath({
  method: 'get',
  path: `${patientPath}/{bookingId}/pdf`,
  operationId: 'downloadPatientExamResultPdf',
  tags: [tags.patient.name],
  summary: 'Baixar o laudo em PDF',
  description: `Gera o laudo em PDF da versão atual do exame \`bookingId\` do paciente logado: unidade, nome do paciente, código do exame, datas e os itens com valor, referência e indicador, ou o laudo do exame de imagem. Responde como anexo (\`Content-Disposition: attachment; filename=laudo-<código>.pdf\`). Exame de outra pessoa, consulta ou exame sem resultado respondem 404. Cada laudo gerado fica na auditoria como \`exam_result.read\`, como na leitura. Limite: 20 laudos por minuto por IP.`,
  ...sessionSecurity,
  request: { params: bookingParams },
  responses: {
    200: {
      description: 'Laudo em PDF.',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    },
    400: validationErrorResponse,
    401: unauthenticatedResponse,
    403: forbiddenResponse,
    404: notFoundResponse(resultNotFound),
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

documentOperation({
  method: 'get',
  path: `${patientPath}/{bookingId}`,
  operationId: 'getPatientExamResult',
  tag: tags.patient.name,
  summary: 'Ver o resultado de um exame',
  description: `Resultado do exame \`bookingId\` do paciente logado: o cabeçalho do exame, a versão atual (a de maior número) com os itens e o indicador de cada valor ou o laudo, e as versões anteriores, imutáveis, também com o conteúdo, da mais nova para a mais antiga. Exame de outra pessoa, consulta ou exame ainda sem resultado respondem 404. O administrador não tem rota para ver resultados. ${auditNote}`,
  params: bookingParams,
  success: { status: 200, description: 'Resultado do exame.', schema: examResultSchema },
  errors: { 403: forbiddenResponse, 404: notFoundResponse(resultNotFound) },
});

documentOperation({
  method: 'get',
  path: `${doctorPath}/{patientId}/exam-results`,
  operationId: 'listDoctorPatientExamResults',
  tag: tags.doctor.name,
  summary: 'Ver os resultados de exame de um paciente',
  description: `Resultados de exame do paciente \`patientId\`, do exame mais recente para o mais antigo, cada um com a versão atual e as anteriores. Exige que o médico logado tenha com o paciente uma consulta do tipo avaliação de exames (\`exam_review\`) confirmada ou concluída que já começou há no máximo 30 dias; sem esse vínculo, inclusive com um paciente inexistente, a resposta é 403 \`${noExamReview.code}\`, sem revelar se o paciente existe. ${auditNote}`,
  params: patientParams,
  query: paginationQuery,
  success: { status: 200, description: 'Página de resultados do paciente.', schema: examResultPageSchema },
  errors: {
    403: errorResponse(
      `Sem o perfil de médico (\`FORBIDDEN\`) ou sem consulta de avaliação de exames com o paciente nos últimos 30 dias (\`${noExamReview.code}\`).`,
      noExamReview,
    ),
  },
});

export interface ExamResultsRouterDeps {
  controller: ExamResultsController;
  requireAuth: RequestHandler;
  requirePatient: RequestHandler;
  requireDoctor: RequestHandler;
}

export function createExamResultsRouter({
  controller,
  requireAuth,
  requirePatient,
  requireDoctor,
}: ExamResultsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const pdfLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 20 });
  const router = Router();
  router.get(patientPath, readLimit, noStore, requireAuth, requirePatient, controller.patientResults);
  router.get(`${patientPath}/:bookingId/pdf`, pdfLimit, noStore, requireAuth, requirePatient, controller.patientPdf);
  router.get(`${patientPath}/:bookingId`, readLimit, noStore, requireAuth, requirePatient, controller.patientResult);
  router.get(
    `${doctorPath}/:patientId/exam-results`,
    readLimit,
    noStore,
    requireAuth,
    requireDoctor,
    controller.doctorResults,
  );
  return router;
}
