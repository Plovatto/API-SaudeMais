import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  errorResponse,
  internalErrorResponse,
  jsonBody,
  serverBusyResponse,
  tooManyRequestsResponse,
  validationErrorResponse,
} from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { resetConfirmSchema, resetRequestSchema } from './password-reset.model.js';
import type { PasswordResetService } from './password-reset.service.js';

registry.registerPath({
  method: 'post',
  path: '/api/password-reset/request',
  operationId: 'requestPasswordReset',
  tags: [tags.accounts.name],
  summary: 'Pedir link para redefinir a senha',
  description:
    'Envia ao e-mail um link válido por 30 minutos. A resposta é sempre 204, exista ou não a conta. Cada conta recebe no máximo um link a cada 15 minutos e 3 por dia; contas de demonstração e desativadas não recebem. Pedir de novo invalida o link anterior. Limite: 10 pedidos por IP a cada 15 minutos.',
  request: { body: jsonBody(resetRequestSchema) },
  responses: {
    204: { description: 'Pedido recebido.' },
    400: validationErrorResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/password-reset/confirm',
  operationId: 'confirmPasswordReset',
  tags: [tags.accounts.name],
  summary: 'Criar uma nova senha com o link',
  description:
    'Troca a senha usando o token do link. O token vale uma vez só; depois da troca, todas as sessões da conta são encerradas. Limite: 20 tentativas por IP a cada 15 minutos.',
  request: { body: jsonBody(resetConfirmSchema) },
  responses: {
    204: { description: 'Senha redefinida.' },
    400: errorResponse('Dados inválidos, ou link inválido, usado ou vencido (`INVALID_RESET_TOKEN`).', {
      message: 'Este link é inválido ou já venceu. Peça um novo.',
      code: 'INVALID_RESET_TOKEN',
      fields: { token: 'Este link é inválido ou já venceu. Peça um novo.' },
    }),
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
    503: serverBusyResponse,
  },
});

export function createPasswordResetRouter(service: PasswordResetService): Router {
  const requestLimit = rateLimit({ ...rateLimitDefaults, windowMs: 15 * MINUTE, limit: 10 });
  const confirmLimit = rateLimit({ ...rateLimitDefaults, windowMs: 15 * MINUTE, limit: 20 });
  const request: RequestHandler = async (req, res) => {
    await service.request(resetRequestSchema.parse(req.body));
    res.status(204).end();
  };
  const confirm: RequestHandler = async (req, res) => {
    await service.confirm(resetConfirmSchema.parse(req.body));
    res.status(204).end();
  };

  const router = Router();
  router.post('/api/password-reset/request', requestLimit, request);
  router.post('/api/password-reset/confirm', confirmLimit, confirm);
  return router;
}
