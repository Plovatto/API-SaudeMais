import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { NotificationsController } from './notifications.controller.js';
import { notificationNotFound } from './notifications.messages.js';
import { areaQuery, notificationPageSchema, notificationsQuery, unreadCountSchema } from './notifications.model.js';

const path = '/api/notifications';
const roleErrors = { 403: forbiddenResponse };

documentOperation({
  method: 'get',
  path,
  operationId: 'listNotifications',
  tag: tags.notifications.name,
  summary: 'Listar avisos',
  description:
    'Avisos da conta para o perfil da área aberta (`role`), do mais novo para o mais antigo, lidos e não lidos. `role` precisa ser um perfil da conta. Limite: 120 leituras por minuto por IP.',
  query: notificationsQuery,
  success: { status: 200, description: 'Página de avisos.', schema: notificationPageSchema },
  errors: roleErrors,
});

documentOperation({
  method: 'get',
  path: `${path}/unread-count`,
  operationId: 'countUnreadNotifications',
  tag: tags.notifications.name,
  summary: 'Contar avisos não lidos',
  description:
    'Quantos avisos não lidos o perfil da área aberta (`role`) tem. O número fica guardado na memória do servidor por até 10 minutos, para a consulta periódica não acordar o banco; avisos criados pela própria API atualizam o número na hora, e os criados por tarefas agendadas aparecem quando ele vence. Consulte só com a aba visível, a cada 2 minutos e ao voltar o foco. Limite: 120 leituras por minuto por IP.',
  query: areaQuery,
  success: { status: 200, description: 'Total de avisos não lidos.', schema: unreadCountSchema },
  errors: roleErrors,
});

documentOperation({
  method: 'post',
  path: `${path}/{id}/read`,
  operationId: 'readNotification',
  tag: tags.notifications.name,
  summary: 'Marcar um aviso como lido',
  description:
    'Marca o aviso como lido. Repetir não tem efeito e mantém o horário da primeira leitura. Aviso de outra conta responde como inexistente. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  success: { status: 204, description: 'Aviso lido.' },
  errors: { 404: notFoundResponse(notificationNotFound) },
});

documentOperation({
  method: 'post',
  path: `${path}/read-all`,
  operationId: 'readAllNotifications',
  tag: tags.notifications.name,
  summary: 'Marcar todos os avisos como lidos',
  description:
    'Marca como lidos todos os avisos do perfil da área aberta (`role`); os dos outros perfis da conta não mudam. Limite: 60 requisições por minuto por IP.',
  query: areaQuery,
  success: { status: 204, description: 'Avisos lidos.' },
  errors: roleErrors,
});

export interface NotificationsRouterDeps {
  controller: NotificationsController;
  requireAuth: RequestHandler;
}

export function createNotificationsRouter({ controller, requireAuth }: NotificationsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const writeLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 60 });
  const router = Router();
  router.get(path, readLimit, noStore, requireAuth, controller.page);
  router.get(`${path}/unread-count`, readLimit, noStore, requireAuth, controller.unreadCount);
  router.post(`${path}/read-all`, writeLimit, noStore, requireAuth, controller.markAllRead);
  router.post(`${path}/:id/read`, writeLimit, noStore, requireAuth, controller.markRead);
  return router;
}
