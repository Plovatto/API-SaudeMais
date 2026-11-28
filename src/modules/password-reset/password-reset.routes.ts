import { Router, type RequestHandler } from 'express';
import { errorResponse, serverBusyResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { publicSecurity } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { runInBackground } from '../../lib/background.js';
import { DAY, MINUTE } from '../../lib/time.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import { resetConfirmSchema, resetRequestSchema } from './password-reset.model.js';
import { INVALID_RESET_TOKEN_MESSAGE, type PasswordResetService } from './password-reset.service.js';

documentOperation({
  method: 'post',
  path: '/api/password-reset/request',
  operationId: 'requestPasswordReset',
  tag: tags.accounts.name,
  summary: 'Pedir link para redefinir a senha',
  description:
    'Envia ao e-mail um link válido por 30 minutos. A resposta é sempre 204 e sai antes de qualquer busca, exista ou não uma conta ativa com o e-mail, para não revelar quem tem conta. Só contas ativas recebem o link, no máximo um a cada 30 segundos e 5 por hora; fora disso nada é enviado. Pedir de novo invalida o link anterior. Limite: 10 pedidos por IP a cada 15 minutos e 30 por dia.',
  auth: publicSecurity,
  body: resetRequestSchema,
  success: { status: 204, description: 'Pedido recebido. Se houver conta ativa com o e-mail, o link segue por e-mail.' },
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
  const requestLimit = limitRequests(10, 15 * MINUTE);
  const requestDailyLimit = limitRequests(30, DAY);
  const confirmLimit = limitRequests(20, 15 * MINUTE);
  const request: RequestHandler = (req, res) => {
    const input = resetRequestSchema.parse(req.body);
    res.status(204).end();
    runInBackground(() => service.request(input), 'Password reset request failed');
  };
  const confirm: RequestHandler = async (req, res) => {
    await service.confirm(resetConfirmSchema.parse(req.body));
    res.status(204).end();
  };

  const router = Router();
  router.post('/api/password-reset/request', requestLimit, requestDailyLimit, request);
  router.post('/api/password-reset/confirm', confirmLimit, confirm);
  return router;
}
