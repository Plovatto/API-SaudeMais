import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  conflictResponse,
  errorResponse,
  exampleRestrictedResponse,
  forbiddenResponse,
  notFoundResponse,
  serverBusyResponse,
} from '../../docs/common-schemas.js';
import { documentOperation, type OperationDoc } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import type { FieldConflict } from '../../lib/app-error.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { WELCOME_TOKEN_HOURS } from '../password-reset/password-reset.service.js';
import { updateProfileSchema } from '../users/user.model.js';
import { emailConflicts } from '../users/user.messages.js';
import type { AdminUserController } from './admin-users.controller.js';
import {
  adminConflicts,
  doctorProfileNotFound,
  inDoctorProfile,
  unavailable,
  userNotFound,
} from './admin-users.messages.js';
import {
  adminUserDetailSchema,
  adminUserPageSchema,
  createUserSchema,
  deactivationImpactSchema,
  doctorProfileInputSchema,
  roleParams,
  updateDoctorProfileSchema,
  usersQuery,
} from './admin-users.model.js';

const userMissing = notFoundResponse(userNotFound);
const unavailableResponse = ({ code, field, message }: FieldConflict) =>
  errorResponse('Especialidade ou unidade inativa ou inexistente (`SPECIALTY_UNAVAILABLE`, `UNIT_UNAVAILABLE`).', {
    message,
    code,
    fields: { [field]: message },
  });

interface Operation extends Omit<OperationDoc, 'tag' | 'errors'> {
  notFound?: string;
  conflict?: ReturnType<typeof conflictResponse>;
  unprocessable?: FieldConflict;
  busy?: boolean;
  restricted?: boolean;
}

function document({ notFound, conflict, unprocessable, busy, restricted, ...operation }: Operation) {
  documentOperation({
    ...operation,
    tag: tags.administration.name,
    errors: {
      403: restricted ? exampleRestrictedResponse : forbiddenResponse,
      ...(operation.params && { 404: notFound ? notFoundResponse(notFound) : userMissing }),
      ...(conflict && { 409: conflict }),
      ...(unprocessable && { 422: unavailableResponse(unprocessable) }),
      ...(busy && { 503: serverBusyResponse }),
    },
  });
}

const detail = { schema: adminUserDetailSchema };

document({
  method: 'get',
  path: '/api/admin/users',
  operationId: 'adminListUsers',
  summary: 'Listar usuários',
  description:
    'Lista paginada em ordem alfabética. `search` procura no nome (sem distinguir acentos) e no e-mail; `role` e `status` filtram por perfil e por conta ativa ou desativada. Nunca mostra senhas, observações nem resultados.',
  query: usersQuery,
  success: { status: 200, description: 'Página de usuários.', schema: adminUserPageSchema },
});
document({
  method: 'post',
  path: '/api/admin/users',
  operationId: 'adminCreateUser',
  summary: 'Cadastrar usuário',
  description: `Cria uma conta de paciente, médico ou administrador. Toda conta também é paciente; para \`doctor\`, envie \`doctorProfile\` (o conselho vem da especialidade). A conta nasce sem senha utilizável: entrar antes de criar a senha responde \`INVALID_CREDENTIALS\`. Depois de salvar, a pessoa recebe por e-mail um link válido por ${WELCOME_TOKEN_HOURS} horas para criar a senha em \`POST /api/password-reset/confirm\`; esse link conta nos limites por conta de \`POST /api/admin/users/{id}/password-reset\`. Fica no registro de auditoria (\`user.created\`) e, ao contrário do autocadastro, não gera o aviso \`user_registered\` para os administradores.`,
  body: createUserSchema,
  conflict: conflictResponse(emailConflicts.users_email_key, inDoctorProfile(adminConflicts.registryTaken)),
  unprocessable: inDoctorProfile(unavailable.specialty),
  busy: true,
  restricted: true,
  success: { status: 201, description: 'Usuário cadastrado.', ...detail },
});
document({
  method: 'get',
  path: '/api/admin/users/{id}',
  operationId: 'adminGetUser',
  summary: 'Ver um usuário',
  description: 'Dados da conta, perfis e, quando houver, o perfil médico.',
  params: idParams,
  success: { status: 200, description: 'Usuário.', ...detail },
});
document({
  method: 'patch',
  path: '/api/admin/users/{id}',
  operationId: 'adminUpdateUser',
  summary: 'Alterar nome ou telefone',
  description: 'Altera só os campos enviados. O e-mail não muda, e o administrador nunca vê nem define senhas.',
  params: idParams,
  body: updateProfileSchema,
  success: { status: 200, description: 'Usuário atualizado.', ...detail },
});
document({
  method: 'get',
  path: '/api/admin/users/{id}/deactivation-impact',
  operationId: 'adminDeactivationImpact',
  summary: 'Ver o impacto de desativar',
  description: 'Quantos agendamentos futuros seriam cancelados se a conta fosse desativada.',
  params: idParams,
  success: { status: 200, description: 'Agendamentos afetados.', schema: deactivationImpactSchema },
});
document({
  method: 'post',
  path: '/api/admin/users/{id}/deactivate',
  operationId: 'adminDeactivateUser',
  summary: 'Desativar conta',
  description:
    'Bloqueia o login e encerra todas as sessões; cancela os agendamentos ativos futuros da pessoa, como paciente e como médico, e avisa a outra parte (`appointment_cancelled`). Não é possível desativar a própria conta nem o último administrador. Repetir não tem efeito.',
  params: idParams,
  conflict: conflictResponse(adminConflicts.selfOrLastAdmin),
  success: { status: 200, description: 'Conta desativada.', ...detail },
});
document({
  method: 'post',
  path: '/api/admin/users/{id}/reactivate',
  operationId: 'adminReactivateUser',
  summary: 'Reativar conta',
  description: 'Libera o login de novo. Repetir não tem efeito.',
  params: idParams,
  success: { status: 200, description: 'Conta reativada.', ...detail },
});
document({
  method: 'post',
  path: '/api/admin/users/{id}/password-reset',
  operationId: 'adminSendPasswordReset',
  summary: 'Enviar link de redefinição de senha',
  description:
    'Envia ao e-mail da conta um link para a própria pessoa criar a senha, com os mesmos limites do pedido feito por ela.',
  params: idParams,
  conflict: conflictResponse(adminConflicts.resetNotSent, adminConflicts.inactive),
  success: { status: 202, description: 'Link enviado.' },
});
document({
  method: 'post',
  path: '/api/admin/users/{id}/roles/{role}',
  operationId: 'adminGrantRole',
  summary: 'Tornar administrador',
  description: 'Concede o perfil de administrador. Para médicos, use o perfil médico. Repetir não tem efeito.',
  params: roleParams,
  conflict: conflictResponse(adminConflicts.inactive),
  restricted: true,
  success: { status: 200, description: 'Perfil concedido.', ...detail },
});
document({
  method: 'delete',
  path: '/api/admin/users/{id}/roles/{role}',
  operationId: 'adminRevokeRole',
  summary: 'Tirar o perfil de administrador',
  description: 'Não é possível tirar o perfil da própria conta nem do último administrador ativo.',
  params: roleParams,
  conflict: conflictResponse(adminConflicts.selfOrLastAdmin),
  success: { status: 200, description: 'Perfil removido.', ...detail },
});
document({
  method: 'post',
  path: '/api/admin/users/{id}/doctor-profile',
  operationId: 'adminCreateDoctorProfile',
  summary: 'Tornar médico',
  description:
    'Cria o perfil médico com especialidade, unidade e registro profissional, e concede o perfil de médico. O conselho vem da especialidade.',
  params: idParams,
  body: doctorProfileInputSchema,
  conflict: conflictResponse(adminConflicts.registryTaken, adminConflicts.profileExists, adminConflicts.inactive),
  unprocessable: unavailable.specialty,
  success: { status: 201, description: 'Perfil médico criado.', ...detail },
});
document({
  method: 'patch',
  path: '/api/admin/users/{id}/doctor-profile',
  operationId: 'adminUpdateDoctorProfile',
  summary: 'Alterar perfil médico',
  description:
    'Altera só os campos enviados. Trocar especialidade ou unidade é recusado enquanto o médico tiver consultas futuras.',
  params: idParams,
  body: updateDoctorProfileSchema,
  notFound: doctorProfileNotFound,
  conflict: conflictResponse(adminConflicts.registryTaken, adminConflicts.futureAppointments),
  unprocessable: unavailable.specialty,
  success: { status: 200, description: 'Perfil médico atualizado.', ...detail },
});
document({
  method: 'delete',
  path: '/api/admin/users/{id}/doctor-profile',
  operationId: 'adminDeleteDoctorProfile',
  summary: 'Remover perfil médico',
  description:
    'Tira o perfil de médico da conta; os dados do registro ficam guardados para o histórico e podem voltar a valer com um novo POST. As consultas ativas futuras que ele atende são canceladas e os pacientes recebem o aviso `appointment_cancelled`.',
  params: idParams,
  notFound: doctorProfileNotFound,
  success: { status: 200, description: 'Perfil médico removido.', ...detail },
});

interface AdminUserRouterDeps {
  controller: AdminUserController;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createAdminUserRouter({ controller, requireAuth, requireAdmin }: AdminUserRouterDeps): Router {
  const adminLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const adminOnly = [noStore, requireAuth, requireAdmin];

  const router = Router();
  router.get('/api/admin/users', adminLimit, ...adminOnly, controller.page);
  router.post('/api/admin/users', adminLimit, ...adminOnly, controller.create);
  router.get('/api/admin/users/:id', adminLimit, ...adminOnly, controller.detail);
  router.patch('/api/admin/users/:id', adminLimit, ...adminOnly, controller.update);
  router.get('/api/admin/users/:id/deactivation-impact', adminLimit, ...adminOnly, controller.impact);
  router.post('/api/admin/users/:id/deactivate', adminLimit, ...adminOnly, controller.deactivate);
  router.post('/api/admin/users/:id/reactivate', adminLimit, ...adminOnly, controller.reactivate);
  router.post('/api/admin/users/:id/password-reset', adminLimit, ...adminOnly, controller.passwordReset);
  router.post('/api/admin/users/:id/roles/:role', adminLimit, ...adminOnly, controller.grantRole);
  router.delete('/api/admin/users/:id/roles/:role', adminLimit, ...adminOnly, controller.revokeRole);
  router.post('/api/admin/users/:id/doctor-profile', adminLimit, ...adminOnly, controller.createDoctorProfile);
  router.patch('/api/admin/users/:id/doctor-profile', adminLimit, ...adminOnly, controller.updateDoctorProfile);
  router.delete('/api/admin/users/:id/doctor-profile', adminLimit, ...adminOnly, controller.deleteDoctorProfile);
  return router;
}
