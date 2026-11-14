import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
  protectedAccountResponse,
} from '../../docs/common-schemas.js';
import { documentOperation } from '../../docs/operation.js';
import { tags } from '../../docs/tags.js';
import { MINUTE } from '../../lib/time.js';
import { noStore } from '../../middleware/auth.js';
import { rateLimitDefaults } from '../../middleware/rate-limit.js';
import type { DoctorScheduleController } from './doctor-schedule.controller.js';
import { scheduleMessages } from './doctor-schedule.messages.js';
import { savedScheduleSchema, saveScheduleSchema, scheduleSchema } from './doctor-schedule.model.js';

const path = '/api/doctor/schedule';
const profileMissing = notFoundResponse(scheduleMessages.profileMissing);

documentOperation({
  method: 'get',
  path,
  operationId: 'getDoctorSchedule',
  tag: tags.doctor.name,
  summary: 'Ver a agenda semanal',
  description:
    'Os 7 dias da semana do médico logado, com as faixas de atendimento em minutos desde 00:00, e o horário da unidade dele. Sem agenda salva, todos os dias vêm inativos e sem faixas. Limite: 120 requisições por minuto por IP.',
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
    'Substitui a agenda inteira de uma vez: envie os 7 dias, cada um com `isActive` e as faixas em minutos desde 00:00 (de 0 a 1440, início antes do fim). Dia inativo guarda as faixas e não gera vagas. As faixas de um dia não podem se sobrepor, mas podem se encostar, e precisam caber no horário da unidade do médico. Nenhuma consulta é cancelada: `warnings` lista as consultas futuras que ficaram fora das novas faixas. A conta de demonstração só lê. Limite: 30 requisições por minuto por IP.',
  body: saveScheduleSchema,
  success: { status: 200, description: 'Agenda salva.', schema: savedScheduleSchema },
  errors: {
    403: protectedAccountResponse('médico'),
    404: profileMissing,
    422: errorResponse('Faixas sobrepostas (`OVERLAP`) ou fora do horário da unidade (`OUTSIDE_UNIT_HOURS`).', {
      message: scheduleMessages.overlap.message,
      code: scheduleMessages.overlap.code,
      fields: { 'days.1.ranges.1': scheduleMessages.overlap.message },
    }),
  },
});

export interface DoctorScheduleRouterDeps {
  controller: DoctorScheduleController;
  requireAuth: RequestHandler;
  requireDoctor: RequestHandler;
  requireWritable: RequestHandler;
}

export function createDoctorScheduleRouter({
  controller,
  requireAuth,
  requireDoctor,
  requireWritable,
}: DoctorScheduleRouterDeps): Router {
  const readLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 120 });
  const saveLimit = rateLimit({ ...rateLimitDefaults, windowMs: MINUTE, limit: 30 });
  const router = Router();
  router.get(path, readLimit, noStore, requireAuth, requireDoctor, controller.schedule);
  router.put(path, saveLimit, noStore, requireAuth, requireDoctor, requireWritable, controller.save);
  return router;
}
