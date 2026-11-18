import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { errorResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { authOf, noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { emailPreferenceSchema, topicNotAvailable, updateEmailPreferencesSchema } from './email-notifications.model.js';
import type { EmailNotificationsService } from './email-notifications.service.js';

const path = '/api/me/email-preferences';
const preferencesSchema = z.array(emailPreferenceSchema);
const limitNote = 'Limite: 120 requisições de perfil por minuto por IP.';
const deliveryNote =
  'Os e-mails saem junto com os avisos do app e o lembrete sai até 24 horas antes de consultas e exames confirmados. Contas desativadas não recebem e-mail.';

documentOperation({
  method: 'get',
  path,
  operationId: 'listEmailPreferences',
  tag: tags.profile.name,
  summary: 'Ver os avisos por e-mail',
  description: `Lista os avisos por e-mail dos perfis da conta, cada um com o perfil a que pertence e se está ligado. Sem escolha gravada, o aviso vem ligado. ${deliveryNote} ${limitNote}`,
  success: { status: 200, description: 'Avisos por e-mail da conta.', schema: preferencesSchema },
});

documentOperation({
  method: 'patch',
  path,
  operationId: 'updateEmailPreferences',
  tag: tags.profile.name,
  summary: 'Ligar ou desligar avisos por e-mail',
  description: `Grava a escolha de cada aviso enviado e devolve a lista completa. Avisos não enviados ficam como estavam. Só aceita avisos dos perfis da conta. ${limitNote}`,
  body: updateEmailPreferencesSchema,
  success: { status: 200, description: 'Avisos por e-mail atualizados.', schema: preferencesSchema },
  errors: {
    422: errorResponse(`Aviso de um perfil que a conta não tem (\`${topicNotAvailable.code}\`).`, topicNotAvailable),
  },
});

export interface EmailNotificationsRouterDeps {
  service: EmailNotificationsService;
  requireAuth: RequestHandler;
}

export function createEmailNotificationsRouter({ service, requireAuth }: EmailNotificationsRouterDeps): Router {
  const profileLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const router = Router();
  router.get(path, noStore, profileLimit, requireAuth, async (req, res) => {
    res.json(await service.preferences(authOf(req)));
  });
  router.patch(path, noStore, profileLimit, requireAuth, async (req, res) => {
    res.json(await service.update(authOf(req), updateEmailPreferencesSchema.parse(req.body)));
  });
  return router;
}
