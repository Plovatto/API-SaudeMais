import { Router, type Request, type RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
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
import { registry, sessionSecurity } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { authOf, noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { UserController } from './user.controller.js';
import { isDemoEmail } from './user.demo.js';
import { z } from 'zod';
import {
  changePasswordSchema,
  loginResponseSchema,
  loginSchema,
  normalizeEmail,
  publicUserSchema,
  registerSchema,
  sessionSchema,
  updateProfileSchema,
} from './user.model.js';

function emailOf(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? normalizeEmail(email).slice(0, 254) : '';
}

const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? '');

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
  ...sessionSecurity,
  responses: {
    204: { description: 'Sessão encerrada.' },
    401: unauthenticatedResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

const protectedAccountResponse = errorResponse('Conta de demonstração (`PROTECTED_ACCOUNT`); não pode ser alterada.', {
  message: 'Esta é uma conta de demonstração e não pode ser alterada.',
  code: 'PROTECTED_ACCOUNT',
});

registry.registerPath({
  method: 'get',
  path: '/api/me',
  operationId: 'getProfile',
  tags: [tags.profile.name],
  summary: 'Ver os próprios dados',
  description: 'Devolve os dados e os perfis da conta dona do token. Limite: 120 leituras de perfil por minuto por IP.',
  ...sessionSecurity,
  responses: {
    200: jsonResponse('Dados da conta.', publicUserSchema),
    401: unauthenticatedResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/me',
  operationId: 'updateProfile',
  tags: [tags.profile.name],
  summary: 'Alterar nome ou telefone',
  description:
    'Altera só os campos enviados. O e-mail não pode ser alterado nesta versão. Limite: 120 requisições de perfil por minuto por IP.',
  ...sessionSecurity,
  request: { body: jsonBody(updateProfileSchema) },
  responses: {
    200: jsonResponse('Dados atualizados.', publicUserSchema),
    400: validationErrorResponse,
    401: unauthenticatedResponse,
    403: protectedAccountResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/me/password',
  operationId: 'changePassword',
  tags: [tags.profile.name],
  summary: 'Trocar a senha',
  description:
    'Exige a senha atual. Depois da troca, todas as outras sessões da conta são encerradas; a sessão atual continua. Limites: 10 tentativas por IP e 5 senhas atuais erradas por conta a cada 15 minutos.',
  ...sessionSecurity,
  request: { body: jsonBody(changePasswordSchema) },
  responses: {
    204: { description: 'Senha trocada.' },
    400: validationErrorResponse,
    401: unauthenticatedResponse,
    403: protectedAccountResponse,
    422: errorResponse('Senha atual incorreta (`INVALID_CURRENT_PASSWORD`).', {
      message: 'A senha atual está incorreta.',
      code: 'INVALID_CURRENT_PASSWORD',
      fields: { currentPassword: 'A senha atual está incorreta.' },
    }),
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
    503: serverBusyResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/me/sessions',
  operationId: 'listSessions',
  tags: [tags.profile.name],
  summary: 'Listar sessões ativas',
  description:
    'Lista as sessões que ainda valem, da usada mais recentemente para a mais antiga, marcando a atual. Limite: 120 requisições de perfil por minuto por IP.',
  ...sessionSecurity,
  responses: {
    200: jsonResponse('Sessões ativas.', z.array(sessionSchema)),
    401: unauthenticatedResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/me/sessions',
  operationId: 'logoutEverywhere',
  tags: [tags.profile.name],
  summary: 'Sair de todas as sessões',
  description:
    'Encerra todas as sessões da conta, inclusive a atual. Na conta de demonstração, encerra só a sessão de quem pediu.',
  ...sessionSecurity,
  responses: {
    204: { description: 'Sessões encerradas.' },
    401: unauthenticatedResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
  },
});

export interface UserRouterDeps {
  controller: UserController;
  requireAuth: RequestHandler;
  requireWritable: RequestHandler;
}

export function createUserRouter({ controller, requireAuth, requireWritable }: UserRouterDeps): Router {
  const registerLimit = rateLimit({ ...rateLimitDefaults, windowMs: 60 * MINUTE, limit: 10 });
  const loginLimitByIp = rateLimit({ ...rateLimitDefaults, windowMs: 15 * MINUTE, limit: 30 });
  const loginLimitByEmailAndIp = rateLimit({
    ...rateLimitDefaults,
    windowMs: 15 * MINUTE,
    limit: 5,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${emailOf(req)}|${ipOf(req)}`,
  });
  const loginLimitByEmail = rateLimit({
    ...rateLimitDefaults,
    windowMs: 60 * MINUTE,
    limit: 50,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => emailOf(req) || `ip:${ipOf(req)}`,
    skip: (req) => isDemoEmail(emailOf(req)),
  });
  const sessionLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 60 });
  const profileLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const passwordLimit = rateLimit({ ...rateLimitDefaults, windowMs: 15 * MINUTE, limit: 10 });
  const passwordLimitByAccount = rateLimit({
    ...rateLimitDefaults,
    windowMs: 15 * MINUTE,
    limit: 5,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => authOf(req).user.id,
  });

  const router = Router();
  router.post('/api/users/register', registerLimit, controller.register);
  router.post('/api/users/login', noStore, loginLimitByIp, loginLimitByEmailAndIp, loginLimitByEmail, controller.login);
  router.post('/api/users/logout', sessionLimit, requireAuth, controller.logout);
  router.get('/api/me', noStore, profileLimit, requireAuth, controller.profile);
  router.patch('/api/me', noStore, profileLimit, requireAuth, requireWritable, controller.updateProfile);
  router.post(
    '/api/me/password',
    passwordLimit,
    requireAuth,
    passwordLimitByAccount,
    requireWritable,
    controller.changePassword,
  );
  router.get('/api/me/sessions', noStore, profileLimit, requireAuth, controller.sessions);
  router.delete('/api/me/sessions', sessionLimit, requireAuth, controller.logoutEverywhere);
  return router;
}
