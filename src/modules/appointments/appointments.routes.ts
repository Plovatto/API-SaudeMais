import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { conflictResponse, errorResponse, forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { doctorNotFound } from '../doctors/doctors.messages.js';
import type { AppointmentsController } from './appointments.controller.js';
import { ACTIVE_LIMIT, appointmentConflicts, appointmentNotFound, appointmentRules } from './appointments.messages.js';
import { appointmentSchema, bookAppointmentSchema } from './appointments.model.js';

const path = '/api/appointments';
const { outsideAvailability } = appointmentRules;

documentOperation({
  method: 'post',
  path,
  operationId: 'bookAppointment',
  tag: tags.scheduling.name,
  summary: 'Pedir uma consulta',
  description: `Cria o pedido de consulta do paciente logado, que nasce pendente (\`pending\`) até o médico confirmar, e avisa o médico. \`startsAt\` precisa ser o início de uma vaga devolvida por \`GET /api/doctors/{id}/availability\`; o fim vem da duração atual da especialidade. A unidade e a especialidade gravadas são as do perfil do médico. Contas comuns têm no máximo ${ACTIVE_LIMIT} agendamentos ativos futuros. Se duas pessoas pedem a mesma vaga ao mesmo tempo, só uma consegue; a outra recebe \`SLOT_TAKEN\`. Limite: 60 requisições por minuto por IP.`,
  body: bookAppointmentSchema,
  success: { status: 201, description: 'Pedido criado.', schema: appointmentSchema },
  errors: {
    403: forbiddenResponse,
    404: notFoundResponse(doctorNotFound),
    409: conflictResponse(appointmentConflicts.slotTaken, appointmentConflicts.patientConflict),
    422: errorResponse(
      'Vaga inexistente (`OUTSIDE_AVAILABILITY`), limite de agendamentos ativos (`ACTIVE_LIMIT`), especialidade que o médico não atende (`SPECIALTY_MISMATCH`) ou consulta consigo mesmo (`SELF_BOOKING`).',
      {
        message: outsideAvailability.message,
        code: outsideAvailability.code,
        fields: { [outsideAvailability.field]: outsideAvailability.message },
      },
    ),
  },
});

documentOperation({
  method: 'get',
  path: `${path}/{id}`,
  operationId: 'getAppointment',
  tag: tags.scheduling.name,
  summary: 'Ver uma consulta',
  description:
    'Detalhe da consulta com paciente, médico, especialidade, unidade, observações e histórico. Abre só para o paciente dela e para o médico que a atende; para os demais, responde como inexistente. Limite: 120 requisições por minuto por IP.',
  params: idParams,
  success: { status: 200, description: 'Consulta.', schema: appointmentSchema },
  errors: {
    403: { ...forbiddenResponse, description: 'A conta não tem perfil de paciente nem de médico (`FORBIDDEN`).' },
    404: notFoundResponse(appointmentNotFound),
  },
});

export interface AppointmentsRouterDeps {
  controller: AppointmentsController;
  requireAuth: RequestHandler;
  requirePatient: RequestHandler;
}

export function createAppointmentsRouter({ controller, requireAuth, requirePatient }: AppointmentsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const writeLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 60 });
  const router = Router();
  router.post(path, writeLimit, noStore, requireAuth, requirePatient, controller.book);
  router.get(`${path}/:id`, readLimit, noStore, requireAuth, controller.detail);
  return router;
}
