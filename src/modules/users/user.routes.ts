import { Router, type Request, type RequestHandler } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  errorResponse,
  exampleAccountResponse,
  fieldErrorExample,
  notFoundResponse,
  serverBusyResponse,
} from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { publicSecurity } from '../../docs/registry.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { authOf, noStore } from '../../middleware/auth.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import type { UserController } from './user.controller.js';
import {
  currentSession,
  emailConflicts,
  invalidCredentials,
  invalidCurrentPassword,
  sessionNotFound,
  userInactive,
} from './user.messages.js';
import { z } from 'zod';
import {
  changePasswordSchema,
  loginResponseSchema,
  loginSchema,
  normalizeEmail,
  profileSchema,
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

documentOperation({
  method: 'post',
  path: '/api/users/register',
  operationId: 'registerUser',
  tag: tags.accounts.name,
  summary: 'Criar conta',
  description:
    'Cria uma conta de paciente e registra o aceite dos termos de uso e da política de privacidade em vigor. O e-mail é comparado sem distinguir maiúsculas. Para entrar, use depois o login. Limite: 10 cadastros por hora por IP.',
  auth: publicSecurity,
  body: registerSchema,
  success: { status: 201, description: 'Conta criada, só com o perfil de paciente.', schema: publicUserSchema },
  errors: {
    409: errorResponse('E-mail já cadastrado (`EMAIL_TAKEN`).', fieldErrorExample(emailConflicts.users_email_key)),
    503: serverBusyResponse,
  },
});

documentOperation({
  method: 'post',
  path: '/api/users/login',
  operationId: 'login',
  tag: tags.accounts.name,
  summary: 'Entrar',
  description:
    'Confere e-mail e senha e devolve um token de sessão. Sem "Lembrar de mim", a sessão expira após 12 horas sem uso; com ele, dura 7 dias. Nenhuma sessão passa de 7 dias. Senha errada e e-mail inexistente recebem a mesma resposta. Limites: 30 tentativas por IP e 5 senhas erradas por e-mail e IP a cada 15 minutos, e 50 senhas erradas por e-mail por hora. Esse último limite não vale para um IP que já tem sessão da conta, para que errar a senha de alguém não tranque essa pessoa no aparelho que ela usa.',
  auth: publicSecurity,
  body: loginSchema,
  success: { status: 200, description: 'Login feito.', schema: loginResponseSchema },
  errors: {
    401: errorResponse(`E-mail ou senha incorretos (\`${invalidCredentials.code}\`).`, invalidCredentials),
    403: errorResponse(`Conta desativada (\`${userInactive.code}\`). Só aparece com a senha correta.`, userInactive),
    503: serverBusyResponse,
  },
});

documentOperation({
  method: 'post',
  path: '/api/users/logout',
  operationId: 'logout',
  tag: tags.accounts.name,
  summary: 'Sair',
  description: 'Encerra a sessão do token enviado. As outras sessões da conta continuam valendo.',
  success: { status: 204, description: 'Sessão encerrada.' },
});

documentOperation({
  method: 'get',
  path: '/api/me',
  operationId: 'getProfile',
  tag: tags.profile.name,
  summary: 'Ver os próprios dados',
  description:
    'Devolve os dados e os perfis da conta dona do token, com a data de nascimento e a data da última troca de senha. Limite: 120 leituras de perfil por minuto por IP.',
  success: { status: 200, description: 'Dados da conta.', schema: profileSchema },
});

documentOperation({
  method: 'patch',
  path: '/api/me',
  operationId: 'updateProfile',
  tag: tags.profile.name,
  summary: 'Alterar nome, telefone ou nascimento',
  description:
    'Altera só os campos enviados. A data de nascimento não pode ser no futuro (fuso de São Paulo) nem antes de 1900. O e-mail não pode ser alterado nesta versão. Limite: 120 requisições de perfil por minuto por IP.',
  body: updateProfileSchema,
  success: { status: 200, description: 'Dados atualizados.', schema: profileSchema },
});

documentOperation({
  method: 'post',
  path: '/api/me/password',
  operationId: 'changePassword',
  tag: tags.profile.name,
  summary: 'Trocar a senha',
  description:
    'Exige a senha atual. Depois da troca, todas as outras sessões da conta são encerradas; a sessão atual continua. Limites: 10 tentativas por IP e 5 senhas atuais erradas por conta a cada 15 minutos.',
  body: changePasswordSchema,
  success: { status: 204, description: 'Senha trocada.' },
  errors: {
    403: exampleAccountResponse,
    422: errorResponse(
      `Senha atual incorreta (\`${invalidCurrentPassword.code}\`).`,
      fieldErrorExample(invalidCurrentPassword),
    ),
    503: serverBusyResponse,
  },
});

documentOperation({
  method: 'get',
  path: '/api/me/sessions',
  operationId: 'listSessions',
  tag: tags.profile.name,
  summary: 'Listar sessões ativas',
  description:
    'Lista as sessões que ainda valem, da usada mais recentemente para a mais antiga, marcando a atual. Limite: 120 requisições de perfil por minuto por IP.',
  success: { status: 200, description: 'Sessões ativas.', schema: z.array(sessionSchema) },
});

documentOperation({
  method: 'delete',
  path: '/api/me/sessions',
  operationId: 'logoutEverywhere',
  tag: tags.profile.name,
  summary: 'Sair de todas as sessões',
  description: 'Encerra todas as sessões da conta, inclusive a atual.',
  success: { status: 204, description: 'Sessões encerradas.' },
});

documentOperation({
  method: 'delete',
  path: '/api/me/sessions/others',
  operationId: 'endOtherSessions',
  tag: tags.profile.name,
  summary: 'Encerrar as outras sessões',
  description: 'Encerra todas as sessões da conta menos a atual. Limite: 60 requisições de sessão por minuto por IP.',
  success: { status: 204, description: 'Outras sessões encerradas.' },
});

documentOperation({
  method: 'delete',
  path: '/api/me/sessions/{id}',
  operationId: 'endSession',
  tag: tags.profile.name,
  summary: 'Encerrar uma sessão',
  description:
    'Encerra uma sessão da própria conta, como a de um aparelho que a pessoa não reconhece. A sessão atual não pode ser encerrada por aqui: use o logout. Sessão de outra conta responde 404, sem revelar se existe. Limite: 60 requisições de sessão por minuto por IP.',
  params: idParams,
  success: { status: 204, description: 'Sessão encerrada.' },
  errors: {
    404: notFoundResponse(sessionNotFound),
    422: errorResponse(`É a sessão em uso (\`${currentSession.code}\`).`, currentSession),
  },
});

interface UserRouterDeps {
  controller: UserController;
  requireAuth: RequestHandler;
  knownDevice: (email: string, ip: string | undefined) => Promise<boolean>;
}

export function createUserRouter({ controller, requireAuth, knownDevice }: UserRouterDeps): Router {
  const registerLimit = limitRequests(10, 60 * MINUTE);
  const loginLimitByIp = limitRequests(30, 15 * MINUTE);
  const loginLimitByEmailAndIp = limitRequests(5, 15 * MINUTE, {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${emailOf(req)}|${ipOf(req)}`,
  });
  const loginLimitByEmail = limitRequests(50, 60 * MINUTE, {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => emailOf(req) || `ip:${ipOf(req)}`,
    skip: (req) => knownDevice(emailOf(req), req.ip),
  });
  const sessionLimit = limitRequests(60);
  const profileLimit = limitRequests(120);
  const passwordLimit = limitRequests(10, 15 * MINUTE);
  const passwordLimitByAccount = limitRequests(5, 15 * MINUTE, {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => authOf(req).user.id,
  });

  const router = Router();
  router.post('/api/users/register', registerLimit, controller.register);
  router.post('/api/users/login', noStore, loginLimitByIp, loginLimitByEmailAndIp, loginLimitByEmail, controller.login);
  router.post('/api/users/logout', sessionLimit, requireAuth, controller.logout);
  router.get('/api/me', noStore, profileLimit, requireAuth, controller.profile);
  router.patch('/api/me', noStore, profileLimit, requireAuth, controller.updateProfile);
  router.post('/api/me/password', passwordLimit, requireAuth, passwordLimitByAccount, controller.changePassword);
  router.get('/api/me/sessions', noStore, profileLimit, requireAuth, controller.sessions);
  router.delete('/api/me/sessions', sessionLimit, requireAuth, controller.logoutEverywhere);
  router.delete('/api/me/sessions/others', sessionLimit, requireAuth, controller.endOtherSessions);
  router.delete('/api/me/sessions/:id', sessionLimit, requireAuth, controller.endSession);
  return router;
}
