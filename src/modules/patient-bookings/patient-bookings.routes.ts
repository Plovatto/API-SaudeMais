import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { forbiddenResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { PatientBookingsController } from './patient-bookings.controller.js';
import { patientBookingPageSchema, patientBookingsQuery, patientHomeSchema } from './patient-bookings.model.js';

const path = '/api/patient';
const errors = { 403: forbiddenResponse };

documentOperation({
  method: 'get',
  path: `${path}/home`,
  operationId: 'getPatientHome',
  tag: tags.patient.name,
  summary: 'Ver o início do paciente',
  description:
    'Os 3 próximos agendamentos, os totais das abas agendados e realizados, o aviso mais recente do perfil de paciente e os cartões de pressão e peso, cada um com a medida mais recente registrada pelo médico ao concluir uma consulta (nulo enquanto não houver). Cada agendamento traz as ações permitidas, como na lista. Limite: 120 requisições por minuto por IP.',
  success: { status: 200, description: 'Início do paciente.', schema: patientHomeSchema },
  errors,
});

documentOperation({
  method: 'get',
  path: `${path}/bookings`,
  operationId: 'listPatientBookings',
  tag: tags.patient.name,
  summary: 'Listar os agendamentos do paciente',
  description:
    'Consultas e exames do paciente logado na aba escolhida em `scope`, com filtros por tipo e por situação. Cada item traz o que o paciente pode fazer (`actions`), calculado pela política de agendamento, para o cliente não repetir as regras. `counts` traz os totais das duas abas, sem os filtros. Limite: 120 requisições por minuto por IP.',
  query: patientBookingsQuery,
  success: { status: 200, description: 'Página de agendamentos.', schema: patientBookingPageSchema },
  errors,
});

export interface PatientBookingsRouterDeps {
  controller: PatientBookingsController;
  requireAuth: RequestHandler;
  requirePatient: RequestHandler;
}

export function createPatientBookingsRouter({
  controller,
  requireAuth,
  requirePatient,
}: PatientBookingsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const router = Router();
  router.get(`${path}/home`, readLimit, noStore, requireAuth, requirePatient, controller.home);
  router.get(`${path}/bookings`, readLimit, noStore, requireAuth, requirePatient, controller.page);
  return router;
}
