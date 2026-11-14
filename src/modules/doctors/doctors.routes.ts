import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { DoctorsController } from './doctors.controller.js';
import { doctorNotFound } from './doctors.messages.js';
import {
  availabilityQuery,
  availabilitySchema,
  doctorPageSchema,
  doctorsQuery,
  MAX_AVAILABILITY_DAYS,
} from './doctors.model.js';

documentOperation({
  method: 'get',
  path: '/api/doctors',
  operationId: 'listDoctors',
  tag: tags.scheduling.name,
  summary: 'Listar médicos',
  description:
    'Médicos que atendem, em ordem alfabética, com especialidade, unidade e registro profissional. `specialtyId` restringe a uma especialidade e `search` procura no nome, sem distinguir acentos nem maiúsculas. Só aparecem contas ativas com perfil médico em especialidade e unidade ativas. Limite: 120 requisições por minuto por IP.',
  query: doctorsQuery,
  success: { status: 200, description: 'Página de médicos.', schema: doctorPageSchema },
  errors: { 403: forbiddenResponse },
});

documentOperation({
  method: 'get',
  path: '/api/doctors/{id}/availability',
  operationId: 'getDoctorAvailability',
  tag: tags.scheduling.name,
  summary: 'Ver as vagas livres de um médico',
  description: `Vagas livres do médico entre \`from\` e \`to\` (datas de São Paulo, até ${MAX_AVAILABILITY_DAYS} dias por vez), agrupadas por dia. Cada vaga dura o tempo de consulta da especialidade, começa no início de uma faixa do médico em passos dessa duração e cabe inteira na faixa e no horário da unidade. Vagas antes da antecedência mínima, depois do horizonte da política de agendamento ou já ocupadas não aparecem, e dias sem vaga ficam de fora. Para agendar, envie o \`startsAt\` recebido, sem montar o horário no cliente. Limite: 120 requisições por minuto por IP.`,
  params: idParams,
  query: availabilityQuery,
  success: { status: 200, description: 'Dias com vagas livres.', schema: availabilitySchema },
  errors: { 403: forbiddenResponse, 404: notFoundResponse(doctorNotFound) },
});

export interface DoctorsRouterDeps {
  controller: DoctorsController;
  requireAuth: RequestHandler;
  requirePatient: RequestHandler;
}

export function createDoctorsRouter({ controller, requireAuth, requirePatient }: DoctorsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const patientOnly = [noStore, requireAuth, requirePatient];
  const router = Router();
  router.get('/api/doctors', readLimit, ...patientOnly, controller.page);
  router.get('/api/doctors/:id/availability', readLimit, ...patientOnly, controller.availability);
  return router;
}
