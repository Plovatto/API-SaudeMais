import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { conflictResponse, errorResponse, forbiddenResponse, notFoundResponse } from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { idParams } from '../../lib/params.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import { ACTIVE_LIMIT, patientConflict, rescheduleConflicts, sameSlot } from '../bookings/bookings.messages.js';
import { doctorNotFound } from '../doctors/doctors.messages.js';
import type { AppointmentsController } from './appointments.controller.js';
import { appointmentConflicts, appointmentNotFound, appointmentRules } from './appointments.messages.js';
import {
  appointmentSchema,
  bookAppointmentSchema,
  cancelAppointmentSchema,
  confirmAppointmentSchema,
  rescheduleSchema,
} from './appointments.model.js';

const path = '/api/appointments';
const { outsideAvailability, reasonRequired } = appointmentRules;

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
    409: conflictResponse(appointmentConflicts.slotTaken, patientConflict),
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

documentOperation({
  method: 'post',
  path: `${path}/{id}/cancel`,
  operationId: 'cancelAppointment',
  tag: tags.scheduling.name,
  summary: 'Cancelar uma consulta',
  description:
    'Cancela uma consulta pendente ou confirmada que ainda não começou e avisa a outra parte depois do commit: o médico recebe `appointment_cancelled_by_patient` e o paciente recebe `appointment_cancelled`. Cancelam o paciente dela, com motivo opcional, e o médico que a atende, com motivo obrigatório. Envie em `startsAt` o início que a tela mostrava: se a consulta mudou, já começou ou já foi encerrada, a resposta é `INVALID_STATE` e nada muda. O paciente pode cancelar uma consulta confirmada dentro da janela da política (`appointmentLateWindowHours`), e o cancelamento fica marcado como tardio. A vaga volta a ficar livre. As contas de demonstração também cancelam, porque os agendamentos delas são restaurados todo dia. Responde o detalhe atualizado; para os demais usuários, responde como inexistente. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  body: cancelAppointmentSchema,
  success: { status: 200, description: 'Consulta cancelada.', schema: appointmentSchema },
  errors: {
    403: { ...forbiddenResponse, description: 'A conta não tem perfil de paciente nem de médico (`FORBIDDEN`).' },
    404: notFoundResponse(appointmentNotFound),
    409: conflictResponse(appointmentConflicts.invalidState),
    422: errorResponse('O médico não informou o motivo (`REASON_REQUIRED`).', {
      message: reasonRequired.message,
      code: reasonRequired.code,
      fields: { [reasonRequired.field]: reasonRequired.message },
    }),
  },
});

documentOperation({
  method: 'post',
  path: `${path}/{id}/confirm`,
  operationId: 'confirmAppointment',
  tag: tags.doctor.name,
  summary: 'Confirmar uma consulta',
  description:
    'Confirma um pedido pendente (`pending`) que ainda não começou, registra o evento `confirmed` com o médico como autor e, depois do commit, avisa o paciente com `appointment_confirmed`. Só o médico que atende a consulta confirma. Envie em `startsAt` o início que a tela mostrava: se o paciente reagendou ou cancelou, se a consulta já foi confirmada ou se o horário já chegou, a resposta é `INVALID_STATE` e nada muda. Horário desatualizado, consulta já iniciada e pedido expirado respondem todos com esse mesmo código; não existem `NOT_STARTED` nem `EXPIRED` nesta rota. A conta de demonstração também confirma, porque os agendamentos dela são restaurados todo dia. Responde o detalhe atualizado; para os demais médicos, responde como inexistente. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  body: confirmAppointmentSchema,
  success: { status: 200, description: 'Consulta confirmada.', schema: appointmentSchema },
  errors: {
    403: forbiddenResponse,
    404: notFoundResponse(appointmentNotFound),
    409: {
      ...conflictResponse(appointmentConflicts.notConfirmable),
      description:
        'O `startsAt` enviado está desatualizado, a consulta já foi confirmada ou cancelada, já começou ou o pedido expirou (`INVALID_STATE`).',
    },
  },
});

documentOperation({
  method: 'post',
  path: `${path}/{id}/reschedule`,
  operationId: 'rescheduleAppointment',
  tag: tags.scheduling.name,
  summary: 'Reagendar uma consulta',
  description:
    'Troca o horário de uma consulta pendente ou confirmada que ainda não começou, na mesma linha e em uma única transação: a consulta volta a pendente (`pending`) até o médico confirmar de novo, `reschedule_count` aumenta, o evento `rescheduled` guarda o horário anterior e o novo, e o médico recebe `appointment_rescheduled` depois do commit. A vaga antiga só fica livre se a nova for garantida. Só o paciente dela reagenda. Envie em `startsAt` o início que a tela mostrava (se mudou, a resposta é `INVALID_STATE`) e em `newStartsAt` o início de uma vaga devolvida por `GET /api/doctors/{id}/availability?rescheduling={id}`, em que a própria consulta não ocupa a agenda. Consulta confirmada dentro da janela da política (`appointmentLateWindowHours`) não pode ser reagendada (`RESCHEDULE_WINDOW_CLOSED`), só cancelada, e cada consulta aceita até `maxReschedules` reagendamentos (`RESCHEDULE_LIMIT`). Erros sobre a nova vaga vêm em `fields.newStartsAt`. Responde o detalhe atualizado; para os demais usuários, responde como inexistente. Limite: 60 requisições por minuto por IP.',
  params: idParams,
  body: rescheduleSchema,
  success: { status: 200, description: 'Consulta reagendada.', schema: appointmentSchema },
  errors: {
    403: forbiddenResponse,
    404: notFoundResponse(appointmentNotFound),
    409: conflictResponse(
      rescheduleConflicts.windowClosed,
      rescheduleConflicts.limit,
      appointmentConflicts.slotTaken,
      patientConflict,
      appointmentConflicts.notReschedulable,
    ),
    422: errorResponse('A nova vaga não existe (`OUTSIDE_AVAILABILITY`) ou é o horário atual (`SAME_SLOT`).', {
      message: sameSlot.message,
      code: sameSlot.code,
      fields: { [sameSlot.field]: sameSlot.message },
    }),
  },
});

export interface AppointmentsRouterDeps {
  controller: AppointmentsController;
  requireAuth: RequestHandler;
  requirePatient: RequestHandler;
  requireDoctor: RequestHandler;
}

export function createAppointmentsRouter({
  controller,
  requireAuth,
  requirePatient,
  requireDoctor,
}: AppointmentsRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const writeLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 60 });
  const router = Router();
  router.post(path, writeLimit, noStore, requireAuth, requirePatient, controller.book);
  router.get(`${path}/:id`, readLimit, noStore, requireAuth, controller.detail);
  router.post(`${path}/:id/confirm`, writeLimit, noStore, requireAuth, requireDoctor, controller.confirm);
  router.post(`${path}/:id/cancel`, writeLimit, noStore, requireAuth, controller.cancel);
  router.post(`${path}/:id/reschedule`, writeLimit, noStore, requireAuth, requirePatient, controller.reschedule);
  return router;
}
