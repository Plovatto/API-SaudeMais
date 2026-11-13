import { Router, type RequestHandler } from 'express';
import {
  errorResponse,
  internalErrorResponse,
  jsonBody,
  serverBusyResponse,
  jsonResponse,
  tooManyRequestsResponse,
  unauthenticatedResponse,
  validationErrorResponse,
} from '../../docs/common-schemas.js';
import { registry, sessionAuth } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import type { UserController } from './user.controller.js';
import { loginResponseSchema, loginSchema, publicUserSchema, registerSchema } from './user.model.js';
import type { UserRateLimits } from './user.rate-limits.js';

registry.registerPath({
  method: 'post',
  path: '/api/users/register',
  operationId: 'registerUser',
  tags: [tags.accounts.name],
  summary: 'Criar conta',
  description:
    'Cria uma conta de paciente e registra o aceite dos termos de uso e da política de privacidade em vigor. O e-mail é comparado sem distinguir maiúsculas. Para entrar, use depois o login. Limite: 10 cadastros por hora por IP.',
  request: { body: jsonBody(registerSchema) },
  responses: {
    201: jsonResponse('Conta criada, só com o perfil de paciente.', publicUserSchema),
    400: validationErrorResponse,
    409: errorResponse('E-mail já cadastrado (`EMAIL_TAKEN`).', {
      message: 'Este e-mail já está cadastrado.',
      code: 'EMAIL_TAKEN',
      fields: { email: 'Este e-mail já está cadastrado.' },
    }),
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
    503: serverBusyResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/login',
  operationId: 'login',
  tags: [tags.accounts.name],
  summary: 'Entrar',
  description:
    'Confere e-mail e senha e devolve um token de sessão. Sem "Lembrar de mim", a sessão expira após 12 horas sem uso; com ele, dura 7 dias. Nenhuma sessão passa de 7 dias. Senha errada e e-mail inexistente recebem a mesma resposta. Limites: 30 tentativas por IP e 5 senhas erradas por e-mail e IP a cada 15 minutos, e 50 senhas erradas por e-mail por hora.',
  request: { body: jsonBody(loginSchema) },
  responses: {
    200: jsonResponse('Login feito.', loginResponseSchema),
    400: validationErrorResponse,
    401: errorResponse('E-mail ou senha incorretos (`INVALID_CREDENTIALS`).', {
      message: 'E-mail ou senha incorretos.',
      code: 'INVALID_CREDENTIALS',
    }),
    403: errorResponse('Conta desativada (`USER_INACTIVE`). Só aparece com a senha correta.', {
      message: 'Esta conta está desativada.',
      code: 'USER_INACTIVE',
    }),
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
    503: serverBusyResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/users/logout',
  operationId: 'logout',
  tags: [tags.accounts.name],
  summary: 'Sair',
  description: 'Encerra a sessão do token enviado. As outras sessões da conta continuam valendo.',
  security: [{ [sessionAuth.name]: [] }],
  responses: {
    204: { description: 'Sessão encerrada.' },
    401: unauthenticatedResponse,
    500: internalErrorResponse,
  },
});

export interface UserRouterDeps {
  controller: UserController;
  requireAuth: RequestHandler;
  rateLimits: UserRateLimits;
}

export function createUserRouter({ controller, requireAuth, rateLimits }: UserRouterDeps): Router {
  const router = Router();
  router.post('/api/users/register', rateLimits.register, controller.register);
  router.post(
    '/api/users/login',
    rateLimits.loginByIp,
    rateLimits.loginByEmailAndIp,
    rateLimits.loginByEmail,
    controller.login,
  );
  router.post('/api/users/logout', requireAuth, controller.logout);
  return router;
}
