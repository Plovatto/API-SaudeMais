import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  conflictResponse,
  errorResponse,
  exampleRestrictedResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { labKeySecurity } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { paginationQuery } from '../../lib/pagination.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { clientOf, INVALID_API_KEY_MESSAGE } from '../../middleware/api-key.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { LabIntegrationController } from './lab-integration.controller.js';
import {
  clientConflicts,
  clientNotFound,
  examNotFound,
  issuedInFuture,
  notEligible,
  resultConflicts,
} from './lab-integration.messages.js';
import {
  clientPageSchema,
  createClientSchema,
  createdClientSchema,
  integrationClientSchema,
  resultInputSchema,
  resultReceiptSchema,
  worklistQuery,
  worklistSchema,
} from './lab-integration.model.js';

const LAB_LIMIT = 60;
const clientsPath = '/api/admin/integration-clients';
const labPath = '/api/integrations/lab';
const labLimitNote = `Limite: ${LAB_LIMIT} requisições por minuto por chave.`;

const invalidKeyResponse = errorResponse('Chave de API ausente, inválida ou revogada (`INVALID_API_KEY`).', {
  message: INVALID_API_KEY_MESSAGE,
  code: 'INVALID_API_KEY',
});

documentOperation({
  method: 'get',
  path: clientsPath,
  operationId: 'adminListIntegrationClients',
  tag: tags.administration.name,
  summary: 'Listar integrações',
  description:
    'Clientes de integração em ordem alfabética, com o prefixo visível da chave, o último uso e a revogação. A chave completa e o hash dela nunca são devolvidos. Limite: 120 requisições por minuto por IP.',
  query: paginationQuery,
  success: { status: 200, description: 'Página de integrações.', schema: clientPageSchema },
  errors: { 403: forbiddenResponse },
});

documentOperation({
  method: 'post',
  path: clientsPath,
  operationId: 'adminCreateIntegrationClient',
  tag: tags.administration.name,
  summary: 'Criar integração',
  description:
    'Cria um cliente de integração e gera a chave de API (`slab_`, 8 letras ou números do prefixo, `_` e 43 caracteres do segredo de 32 bytes). A chave completa aparece só nesta resposta: a API guarda apenas o hash SHA-256. A criação fica na auditoria. Limite: 120 requisições por minuto por IP.',
  body: createClientSchema,
  success: { status: 201, description: 'Integração criada, com a chave.', schema: createdClientSchema },
  errors: { 403: exampleRestrictedResponse, 409: conflictResponse(clientConflicts.integration_clients_name_key) },
});

documentOperation({
  method: 'post',
  path: `${clientsPath}/{id}/revoke`,
  operationId: 'adminRevokeIntegrationClient',
  tag: tags.administration.name,
  summary: 'Revogar a chave de uma integração',
  description:
    'Revoga a chave na hora: as próximas chamadas com ela recebem `INVALID_API_KEY`. Os resultados já publicados continuam guardados. Revogar de novo não muda nada e devolve a integração como está. A revogação fica na auditoria. Limite: 120 requisições por minuto por IP.',
  params: idParams,
  success: { status: 200, description: 'Integração revogada.', schema: integrationClientSchema },
  errors: { 403: forbiddenResponse, 404: notFoundResponse(clientNotFound) },
});

documentOperation({
  method: 'get',
  path: `${labPath}/worklist`,
  operationId: 'getLabWorklist',
  tag: tags.integrations.name,
  auth: labKeySecurity,
  summary: 'Ver os exames que aguardam resultado',
  description: `Exames do dia \`date\` (fuso de São Paulo) que podem receber resultado e ainda não têm: confirmados cujo horário já começou ou concluídos. Exames cancelados, futuros ou com resultado ficam de fora. Cada exame vem só com o código público, o código do tipo de exame e o início, sem dados do paciente, em ordem de horário. ${labLimitNote}`,
  query: worklistQuery,
  success: { status: 200, description: 'Exames que aguardam resultado.', schema: worklistSchema },
  errors: { 401: invalidKeyResponse },
});

documentOperation({
  method: 'post',
  path: `${labPath}/results`,
  operationId: 'publishLabResult',
  tag: tags.integrations.name,
  auth: labKeySecurity,
  summary: 'Publicar o resultado de um exame',
  description: `Publica o resultado do exame \`examCode\`, que precisa estar confirmado com o horário já iniciado ou concluído (\`NOT_ELIGIBLE\`). \`issuedAt\` aceita no máximo 5 minutos à frente do relógio da API (\`ISSUED_IN_FUTURE\`). Exame laboratorial recebe \`items\`; exame de imagem recebe \`report\` (\`WRONG_RESULT_FORMAT\`). A primeira publicação cria a versão 1 (201). Reenviar com o mesmo \`externalId\` e o mesmo conteúdo da versão atual não muda nada (200, \`unchanged\`). Conteúdo diferente com \`status\` \`amended\` cria uma nova versão (200, \`amended\`); com \`final\`, é recusado (\`RESULT_FINAL\`). Outro \`externalId\` para o mesmo exame é recusado (\`RESULT_EXISTS\`), assim como reaproveitar um \`externalId\` em outro exame (\`EXTERNAL_ID_TAKEN\`). As versões são imutáveis. Cada versão nova conclui o exame, registra o evento \`result_received\`, avisa o paciente com a notificação \`exam_result_available\` e fica na auditoria, sem o conteúdo do resultado. Publicações simultâneas do mesmo exame são feitas uma de cada vez. ${labLimitNote}`,
  body: resultInputSchema,
  success: [
    { status: 201, description: 'Resultado criado.', schema: resultReceiptSchema },
    { status: 200, description: 'Reenvio sem efeito ou nova versão.', schema: resultReceiptSchema },
  ],
  errors: {
    401: invalidKeyResponse,
    404: notFoundResponse(examNotFound),
    409: conflictResponse(
      resultConflicts.final,
      resultConflicts.otherResult,
      resultConflicts.exam_results_client_external_id_key,
    ),
    422: errorResponse(
      `Exame cancelado ou futuro (\`${notEligible.code}\`), formato errado para o tipo de exame (\`WRONG_RESULT_FORMAT\`) ou emissão no futuro (\`${issuedInFuture.code}\`).`,
      {
        message: notEligible.message,
        code: notEligible.code,
        fields: { [notEligible.field]: notEligible.message },
      },
    ),
  },
});

interface LabIntegrationRouterDeps {
  controller: LabIntegrationController;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  requireApiKey: RequestHandler;
}

export function createLabIntegrationRouter({
  controller,
  requireAuth,
  requireAdmin,
  requireApiKey,
}: LabIntegrationRouterDeps): Router {
  const adminLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const labLimit = rateLimit({
    ...rateLimitDefaults,
    windowMs: MINUTE,
    limit: LAB_LIMIT,
    keyGenerator: (req) => clientOf(req),
  });
  const adminOnly = [adminLimit, noStore, requireAuth, requireAdmin];
  const labOnly = [noStore, requireApiKey, labLimit];

  const router = Router();
  router.get(clientsPath, ...adminOnly, controller.clientPage);
  router.post(clientsPath, ...adminOnly, controller.createClient);
  router.post(`${clientsPath}/:id/revoke`, ...adminOnly, controller.revokeClient);
  router.get(`${labPath}/worklist`, ...labOnly, controller.worklist);
  router.post(`${labPath}/results`, ...labOnly, controller.publish);
  return router;
}
