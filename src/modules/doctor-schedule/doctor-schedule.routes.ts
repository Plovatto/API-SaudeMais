import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  conflictResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { noStore } from '../../middleware/auth.js';
import { limitRequests } from '../../middleware/rate-limit.js';
import type { DoctorScheduleController } from './doctor-schedule.controller.js';
import { MAX_BOOKING_HORIZON_DAYS } from '../catalog/catalog.model.js';
import { scheduleMessages } from './doctor-schedule.messages.js';
import {
  createdTimeOffSchema,
  createTimeOffSchema,
  savedScheduleSchema,
  saveScheduleSchema,
  scheduleSchema,
  timeOffParams,
  timeOffSchema,
} from './doctor-schedule.model.js';

const path = '/api/doctor/schedule';
const timeOffPath = '/api/doctor/time-off';
const profileMissing = notFoundResponse(scheduleMessages.profileMissing);
const { pastDate, tooFar } = scheduleMessages;

documentOperation({
  method: 'get',
  path,
  operationId: 'getDoctorSchedule',
  tag: tags.doctor.name,
  summary: 'Ver a agenda semanal',
  description:
    'Os 7 dias da semana do médico logado, com as faixas de atendimento em minutos desde 00:00, o horário da unidade dele e a duração de cada consulta. Sem agenda salva, todos os dias vêm inativos e sem faixas. Sem duração própria, vale a da especialidade (`isSpecialtyDefault`). Limite: 120 requisições por minuto por IP.',
  success: { status: 200, description: 'Agenda do médico.', schema: scheduleSchema },
  errors: { 403: forbiddenResponse, 404: profileMissing },
});

documentOperation({
  method: 'put',
  path,
  operationId: 'saveDoctorSchedule',
  tag: tags.doctor.name,
  summary: 'Salvar a agenda semanal',
  description:
    'Substitui a agenda inteira de uma vez: envie os 7 dias, cada um com `isActive` e as faixas em minutos desde 00:00 (de 0 a 1440, início antes do fim). Dia inativo guarda as faixas e não gera vagas. As faixas de um dia não podem se sobrepor, mas podem se encostar, e precisam caber no horário da unidade do médico. `appointmentDurationMin` muda a duração das próximas vagas e consultas (15, 20, 30, 45 ou 60 minutos); `null` volta para a duração da especialidade e, sem o campo, nada muda. Consultas já marcadas mantêm o horário. Nenhuma consulta é cancelada: `warnings` lista as consultas futuras que ficaram fora das novas faixas. Limite: 30 requisições por minuto por IP.',
  body: saveScheduleSchema,
  success: { status: 200, description: 'Agenda salva.', schema: savedScheduleSchema },
  errors: {
    403: forbiddenResponse,
    404: profileMissing,
    422: errorResponse('Faixas sobrepostas (`OVERLAP`) ou fora do horário da unidade (`OUTSIDE_UNIT_HOURS`).', {
      message: scheduleMessages.overlap.message,
      code: scheduleMessages.overlap.code,
      fields: { 'days.1.ranges.1': scheduleMessages.overlap.message },
    }),
  },
});

documentOperation({
  method: 'get',
  path: timeOffPath,
  operationId: 'listDoctorTimeOff',
  tag: tags.doctor.name,
  summary: 'Listar folgas e bloqueios',
  description:
    'Os dias bloqueados do médico logado, de hoje em diante, em ordem de data. Dia bloqueado não gera vagas. Limite: 120 requisições por minuto por IP.',
  success: { status: 200, description: 'Dias bloqueados.', schema: z.array(timeOffSchema) },
  errors: { 403: forbiddenResponse, 404: profileMissing },
});

documentOperation({
  method: 'post',
  path: timeOffPath,
  operationId: 'createDoctorTimeOff',
  tag: tags.doctor.name,
  summary: 'Bloquear um dia',
  description:
    `Bloqueia um dia inteiro, de hoje até ${MAX_BOOKING_HORIZON_DAYS} dias à frente, mesmo além do prazo de agendamento, com um motivo opcional de até 80 caracteres. Pacientes deixam de ver vagas no dia e não conseguem marcar nem reagendar para ele (\`OUTSIDE_AVAILABILITY\`). Nenhuma consulta é cancelada: \`warnings\` lista as consultas pendentes ou confirmadas que já estavam marcadas no dia. Limite: 30 requisições por minuto por IP.`,
  body: createTimeOffSchema,
  success: { status: 201, description: 'Dia bloqueado.', schema: createdTimeOffSchema },
  errors: {
    403: forbiddenResponse,
    404: profileMissing,
    409: conflictResponse(scheduleMessages.timeOffExists),
    422: errorResponse(
      `Data já passou (\`PAST_DATE\`) ou fica a mais de ${MAX_BOOKING_HORIZON_DAYS} dias (\`DATE_TOO_FAR\`).`,
      { message: tooFar.message, code: tooFar.code, fields: { [tooFar.field]: tooFar.message } },
    ),
  },
});

documentOperation({
  method: 'delete',
  path: `${timeOffPath}/{date}`,
  operationId: 'deleteDoctorTimeOff',
  tag: tags.doctor.name,
  summary: 'Desbloquear um dia',
  description:
    'Remove o bloqueio de hoje ou de um dia futuro, que volta a gerar vagas pela agenda semanal. Limite: 30 requisições por minuto por IP.',
  params: timeOffParams,
  success: { status: 204, description: 'Dia desbloqueado.' },
  errors: {
    403: forbiddenResponse,
    404: errorResponse('Médico sem perfil ou dia não bloqueado (`NOT_FOUND`).', {
      message: scheduleMessages.timeOffMissing,
      code: 'NOT_FOUND',
    }),
    422: errorResponse('Data já passou (`PAST_DATE`).', {
      message: pastDate.message,
      code: pastDate.code,
      fields: { [pastDate.field]: pastDate.message },
    }),
  },
});

interface DoctorScheduleRouterDeps {
  controller: DoctorScheduleController;
  requireAuth: RequestHandler;
  requireDoctor: RequestHandler;
}

export function createDoctorScheduleRouter({ controller, requireAuth, requireDoctor }: DoctorScheduleRouterDeps): Router {
  const doctor = (limit: number) => [
    limitRequests(limit),
    noStore,
    requireAuth,
    requireDoctor,
  ];
  const router = Router();
  router.get(path, ...doctor(120), controller.schedule);
  router.put(path, ...doctor(30), controller.save);
  router.get(timeOffPath, ...doctor(120), controller.timeOff);
  router.post(timeOffPath, ...doctor(30), controller.block);
  router.delete(`${timeOffPath}/:date`, ...doctor(30), controller.unblock);
  return router;
}
