import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { errorResponse, serverBusyResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { publicSecurity } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { resetConfirmSchema, resetRequestSchema } from './password-reset.model.js';
import {
  INVALID_RESET_TOKEN_MESSAGE,
  RESET_ACCOUNT_NOT_FOUND_MESSAGE,
  type PasswordResetService,
} from './password-reset.service.js';

documentOperation({
  method: 'post',
  path: '/api/password-reset/request',
  operationId: 'requestPasswordReset',
  tag: tags.accounts.name,
  summary: 'Pedir link para redefinir a senha',
  description:
    'Envia ao e-mail um link válido por 30 minutos. Se não houver conta ativa com o e-mail, responde 404 (`ACCOUNT_NOT_FOUND`) no campo `email`; se o envio for recusado pelos limites a seguir, responde 429 (`RESET_TOO_SOON`). Cada conta recebe no máximo um link a cada 30 segundos e 5 por hora; contas desativadas não recebem. Pedir de novo invalida o link anterior. Limite: 10 pedidos por IP a cada 15 minutos.',
  auth: publicSecurity,
  body: resetRequestSchema,
  success: { status: 204, description: 'Pedido recebido.' },
  errors: {
    404: errorResponse('Não existe conta ativa com o e-mail (`ACCOUNT_NOT_FOUND`).', {
      message: RESET_ACCOUNT_NOT_FOUND_MESSAGE,
      code: 'ACCOUNT_NOT_FOUND',
      fields: { email: RESET_ACCOUNT_NOT_FOUND_MESSAGE },
    }),
  },
});

documentOperation({
  method: 'post',
  path: '/api/password-reset/confirm',
  operationId: 'confirmPasswordReset',
  tag: tags.accounts.name,
  summary: 'Criar uma nova senha com o link',
  description:
    'Troca a senha usando o token do link, seja o de redefinição ou o de criação de senha enviado quando um administrador cadastra a conta. O token vale uma vez só; depois da troca, todas as sessões da conta são encerradas. Limite: 20 tentativas por IP a cada 15 minutos.',
  auth: publicSecurity,
  body: resetConfirmSchema,
  success: { status: 204, description: 'Senha redefinida.' },
  errors: {
    400: errorResponse('Dados inválidos, ou link inválido, usado ou vencido (`INVALID_RESET_TOKEN`).', {
      message: INVALID_RESET_TOKEN_MESSAGE,
      code: 'INVALID_RESET_TOKEN',
      fields: { token: INVALID_RESET_TOKEN_MESSAGE },
    }),
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
