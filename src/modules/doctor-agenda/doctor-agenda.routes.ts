import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { forbiddenResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { DoctorAgendaController } from './doctor-agenda.controller.js';
import { doctorAppointmentPageSchema, doctorAppointmentsQuery, doctorHomeSchema } from './doctor-agenda.model.js';

const path = '/api/doctor';
const errors = { 403: forbiddenResponse };

documentOperation({
  method: 'get',
  path: `${path}/home`,
  operationId: 'getDoctorHome',
  tag: tags.doctor.name,
  summary: 'Ver o início do médico',
  description:
    'O resumo das consultas de hoje no fuso de São Paulo, os 3 próximos pedidos a confirmar, as 3 consultas mais antigas que aguardam registro, os totais das abas da agenda e o aviso mais recente do perfil de médico. Cada consulta traz as ações permitidas, como na agenda. Os totais e as listas saem de uma mesma leitura consistente. Limite: 120 requisições por minuto por IP.',
  success: { status: 200, description: 'Início do médico.', schema: doctorHomeSchema },
  errors,
});

documentOperation({
  method: 'get',
  path: `${path}/appointments`,
  operationId: 'listDoctorAppointments',
  tag: tags.doctor.name,
  summary: 'Listar a agenda do médico',
  description:
    'Consultas do médico logado na aba escolhida em `tab`, a partir do dia `from`, com o paciente (nome e telefone), a especialidade, a unidade e as observações. O médico só vê as próprias consultas. Cada item traz o que o médico pode fazer (`actions`), para o cliente não repetir as regras. `counts` traz os totais das abas, sem os filtros. Limite: 120 requisições por minuto por IP.',
  query: doctorAppointmentsQuery,
  success: { status: 200, description: 'Página da agenda.', schema: doctorAppointmentPageSchema },
  errors,
});

export interface DoctorAgendaRouterDeps {
  controller: DoctorAgendaController;
  requireAuth: RequestHandler;
  requireDoctor: RequestHandler;
}

export function createDoctorAgendaRouter({ controller, requireAuth, requireDoctor }: DoctorAgendaRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const router = Router();
  router.get(`${path}/home`, readLimit, noStore, requireAuth, requireDoctor, controller.home);
  router.get(`${path}/appointments`, readLimit, noStore, requireAuth, requireDoctor, controller.page);
  return router;
}
