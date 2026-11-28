import { Router, type RequestHandler } from 'express';
import { forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { noStore } from '../../middleware/auth.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import type { AnnouncementsController } from './announcements.controller.js';
import { announcementNotFound } from './announcements.messages.js';
import {
  announcementPageSchema,
  announcementSchema,
  announcementsQuery,
  createAnnouncementSchema,
  MAX_VISIBLE_ANNOUNCEMENTS,
  updateAnnouncementSchema,
  visibleAnnouncementsSchema,
  visibleQuery,
} from './announcements.model.js';

const adminPath = '/api/admin/announcements';
const missing = { 404: notFoundResponse(announcementNotFound), 403: forbiddenResponse };

documentOperation({
  method: 'get',
  path: adminPath,
  operationId: 'adminListAnnouncements',
  tag: tags.administration.name,
  summary: 'Listar comunicados',
  description:
    'Lista paginada dos comunicados, do mais novo para o mais antigo, com a situação de cada um calculada na hora (`scheduled`, `active` ou `ended`). `status` filtra por situação. Limite: 120 requisições por minuto por IP.',
  query: announcementsQuery,
  success: { status: 200, description: 'Página de comunicados.', schema: announcementPageSchema },
  errors: { 403: forbiddenResponse },
});

documentOperation({
  method: 'post',
  path: adminPath,
  operationId: 'adminCreateAnnouncement',
  tag: tags.administration.name,
  summary: 'Criar comunicado',
  description:
    'Cria um comunicado para os perfis escolhidos. Sem `startsAt`, ele entra no ar agora; sem `endsAt`, fica até ser apagado. O texto é simples e aparece como foi escrito. Registra `announcement.created` na auditoria. Limite: 60 requisições por minuto por IP.',
  body: createAnnouncementSchema,
  success: { status: 201, description: 'Comunicado criado.', schema: announcementSchema },
  errors: { 403: forbiddenResponse },
});

documentOperation({
  method: 'patch',
  path: `${adminPath}/{id}`,
  operationId: 'adminUpdateAnnouncement',
  tag: tags.administration.name,
  summary: 'Alterar comunicado',
  description:
    'Altera só os campos enviados; `endsAt: null` remove o fim. O fim precisa continuar depois do início. Registra `announcement.updated` na auditoria, com os nomes dos campos alterados. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  body: updateAnnouncementSchema,
  success: { status: 200, description: 'Comunicado atualizado.', schema: announcementSchema },
  errors: missing,
});

documentOperation({
  method: 'delete',
  path: `${adminPath}/{id}`,
  operationId: 'adminDeleteAnnouncement',
  tag: tags.administration.name,
  summary: 'Apagar comunicado',
  description:
    'Apaga o comunicado de vez; ele some na hora para quem o via. Registra `announcement.deleted` na auditoria, guardando o título. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  success: { status: 204, description: 'Comunicado apagado.' },
  errors: missing,
});

documentOperation({
  method: 'get',
  path: '/api/announcements',
  operationId: 'listAnnouncements',
  tag: tags.notifications.name,
  summary: 'Ver os comunicados no ar',
  description: `Comunicados no ar agora para o perfil da área aberta (\`role\`, um perfil da conta), no máximo ${MAX_VISIBLE_ANNOUNCEMENTS}: os críticos primeiro e, dentro de cada grupo, os de início mais recente. Uma conta só vê os comunicados dos perfis dela. O cliente pode consultar ao abrir a área e ao voltar o foco. Limite: 120 requisições por minuto por IP.`,
  query: visibleQuery,
  success: { status: 200, description: 'Comunicados no ar.', schema: visibleAnnouncementsSchema },
  errors: { 403: forbiddenResponse },
});

interface AnnouncementsRouterDeps {
  controller: AnnouncementsController;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

export function createAnnouncementsRouter({
  controller,
  requireAuth,
  requireAdmin,
}: AnnouncementsRouterDeps): Router {
  const readLimit = limitRequests(120);
  const writeLimit = limitRequests(60);
  const adminRead = [readLimit, noStore, requireAuth, requireAdmin];
  const adminWrite = [writeLimit, noStore, requireAuth, requireAdmin];
  const router = Router();
  router.get(adminPath, ...adminRead, controller.page);
  router.post(adminPath, ...adminWrite, controller.create);
  router.patch(`${adminPath}/:id`, ...adminWrite, controller.update);
  router.delete(`${adminPath}/:id`, ...adminWrite, controller.remove);
  router.get('/api/announcements', readLimit, noStore, requireAuth, controller.visible);
  return router;
}
