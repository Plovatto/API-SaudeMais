import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { conflictResponse, errorResponse, forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { ACTIVE_LIMIT, patientConflict } from '../bookings/bookings.messages.js';
import { MAX_AVAILABILITY_DAYS } from '../doctors/doctors.model.js';
import type { ExamBookingsController } from './exam-bookings.controller.js';
import {
  examBookingNotFound,
  examConflicts,
  examOfferNotFound,
  outsideExamAvailability,
} from './exam-bookings.messages.js';
import {
  bookExamSchema,
  cancelExamSchema,
  examAvailabilityQuery,
  examAvailabilitySchema,
  examBookingSchema,
} from './exam-bookings.model.js';

const path = '/api/exam-bookings';

documentOperation({
  method: 'get',
  path: '/api/exam-availability',
  operationId: 'getExamAvailability',
  tag: tags.scheduling.name,
  summary: 'Ver as vagas de um exame na unidade',
  description: `Vagas do exame na unidade entre \`from\` e \`to\` (datas de São Paulo, até ${MAX_AVAILABILITY_DAYS} dias por vez), agrupadas por dia. Cada vaga dura o tempo do tipo de exame e começa na abertura da unidade, em passos dessa duração, cabendo inteira no horário do dia. \`remaining\` é quantos lugares ainda cabem na vaga: a capacidade da oferta menos os exames confirmados que a ocupam, contados por sobreposição de horário. Vagas sem lugar, antes da antecedência mínima ou depois do horizonte da política de agendamento não aparecem, e dias sem vaga ficam de fora. Unidade, tipo de exame ou oferta inativos ou inexistentes respondem \`NOT_FOUND\`. Para agendar, envie o \`startsAt\` recebido, sem montar o horário no cliente. Limite: 120 requisições por minuto por IP.`,
  query: examAvailabilityQuery,
  success: { status: 200, description: 'Dias com vagas livres.', schema: examAvailabilitySchema },
  errors: { 403: forbiddenResponse, 404: notFoundResponse(examOfferNotFound) },
});

documentOperation({
  method: 'post',
  path,
  operationId: 'bookExam',
  tag: tags.scheduling.name,
  summary: 'Agendar um exame',
  description: `Agenda o exame do paciente logado, que já nasce confirmado (\`confirmed\`) e recebe um código público (\`EX-\` e seis letras ou números) para apresentar na unidade. \`startsAt\` precisa ser o início de uma vaga devolvida por \`GET /api/exam-availability\`; o fim vem da duração atual do tipo de exame. O exame ocupa o menor lugar livre da vaga, até a capacidade da oferta. Contas comuns têm no máximo ${ACTIVE_LIMIT} agendamentos ativos futuros, somando consultas e exames. Se o último lugar é disputado ao mesmo tempo, só um paciente consegue; os outros recebem \`NO_CAPACITY\`. Limite: 60 requisições por minuto por IP.`,
  body: bookExamSchema,
  success: { status: 201, description: 'Exame agendado.', schema: examBookingSchema },
  errors: {
    403: forbiddenResponse,
    404: notFoundResponse(examOfferNotFound),
    409: conflictResponse(examConflicts.noCapacity, patientConflict),
    422: errorResponse('Vaga inexistente (`OUTSIDE_AVAILABILITY`) ou limite de agendamentos ativos (`ACTIVE_LIMIT`).', {
      message: outsideExamAvailability.message,
      code: outsideExamAvailability.code,
      fields: { [outsideExamAvailability.field]: outsideExamAvailability.message },
    }),
  },
});

documentOperation({
  method: 'get',
  path: `${path}/{id}`,
  operationId: 'getExamBooking',
  tag: tags.scheduling.name,
  summary: 'Ver um exame',
  description:
    'Detalhe do exame com unidade, tipo de exame e orientações de preparo, código público, observações, cancelamento e histórico. Abre só para o paciente dele; para os demais, responde como inexistente. Limite: 120 requisições por minuto por IP.',
  params: idParams,
  success: { status: 200, description: 'Exame.', schema: examBookingSchema },
  errors: { 403: forbiddenResponse, 404: notFoundResponse(examBookingNotFound) },
});

documentOperation({
  method: 'post',
  path: `${path}/{id}/cancel`,
  operationId: 'cancelExamBooking',
  tag: tags.scheduling.name,
  summary: 'Cancelar um exame',
  description:
    'Cancela um exame confirmado que ainda não começou e libera o lugar na vaga. Só o paciente dele cancela. Envie em `startsAt` o início que a tela mostrava: se o exame mudou, já começou ou já foi encerrado, a resposta é `INVALID_STATE` e nada muda. Dentro da janela da política (`examLateWindowHours`), o cancelamento fica marcado como tardio. As contas de demonstração também cancelam, porque os agendamentos delas são restaurados todo dia. Responde o detalhe atualizado; para os demais usuários, responde como inexistente. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  body: cancelExamSchema,
  success: { status: 200, description: 'Exame cancelado.', schema: examBookingSchema },
  errors: {
    403: forbiddenResponse,
    404: notFoundResponse(examBookingNotFound),
    409: conflictResponse(examConflicts.invalidState),
  },
});

export interface ExamBookingsRouterDeps {
  controller: ExamBookingsController;
  requireAuth: RequestHandler;
  requirePatient: RequestHandler;
}

export function createExamBookingsRouter({ controller, requireAuth, requirePatient }: ExamBookingsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const writeLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 60 });
  const patientOnly = [noStore, requireAuth, requirePatient];
  const router = Router();
  router.get('/api/exam-availability', readLimit, ...patientOnly, controller.availability);
  router.post(path, writeLimit, ...patientOnly, controller.book);
  router.get(`${path}/:id`, readLimit, ...patientOnly, controller.detail);
  router.post(`${path}/:id/cancel`, writeLimit, ...patientOnly, controller.cancel);
  return router;
}
