import type { BookingKind } from '../../database/schema/bookings.js';
import { errorResponse } from '../../docs/common-schemas.js';
import type { FieldConflict } from '../../lib/app-error.js';

type ActiveLimitScope = BookingKind | 'total';

export const patientConflict: FieldConflict = {
  code: 'PATIENT_CONFLICT',
  field: 'startsAt',
  message: 'Você já tem um agendamento que coincide com este horário.',
};

interface ActiveLimitWording {
  one: string;
  many: string;
  adviceOne: string;
  adviceMany: string;
}

const activeLimitWording: Record<ActiveLimitScope, ActiveLimitWording> = {
  total: {
    one: 'agendamento ativo',
    many: 'agendamentos ativos',
    adviceOne: 'Cancele-o ou aguarde a data dele para marcar outro.',
    adviceMany: 'Cancele um ou aguarde a data de um deles para marcar outro.',
  },
  appointment: {
    one: 'consulta ativa',
    many: 'consultas ativas',
    adviceOne: 'Cancele-a ou aguarde a data dela para marcar outra.',
    adviceMany: 'Cancele uma ou aguarde a data de uma delas para marcar outra.',
  },
  exam: {
    one: 'exame ativo',
    many: 'exames ativos',
    adviceOne: 'Cancele-o ou aguarde a data dele para marcar outro.',
    adviceMany: 'Cancele um ou aguarde a data de um deles para marcar outro.',
  },
};

export function activeLimit(scope: ActiveLimitScope, limit: number): FieldConflict {
  const { one, many, adviceOne, adviceMany } = activeLimitWording[scope];
  const single = limit === 1;
  return {
    code: 'ACTIVE_LIMIT',
    field: '_root',
    message: `Você atingiu o limite de ${limit} ${single ? one : many}. ${single ? adviceOne : adviceMany}`,
  };
}

export const notStarted: FieldConflict = {
  code: 'NOT_STARTED',
  field: '_root',
  message: 'Esta consulta ainda não começou. Conclua ou registre a falta a partir do horário de início.',
};

export const rescheduleConflicts = {
  windowClosed: {
    code: 'RESCHEDULE_WINDOW_CLOSED',
    field: '_root',
    message: 'Falta pouco para o horário e este agendamento não pode mais ser reagendado. Você ainda pode cancelá-lo.',
  },
  limit: {
    code: 'RESCHEDULE_LIMIT',
    field: '_root',
    message: 'Este agendamento já foi reagendado o máximo de vezes permitido.',
  },
} satisfies Record<string, FieldConflict>;

export const sameSlot: FieldConflict = {
  code: 'SAME_SLOT',
  field: 'newStartsAt',
  message: 'Escolha um horário diferente do atual.',
};

export const sameSlotResponse = errorResponse(
  'A nova vaga não existe (`OUTSIDE_AVAILABILITY`) ou é o horário atual (`SAME_SLOT`).',
  { message: sameSlot.message, code: sameSlot.code, fields: { [sameSlot.field]: sameSlot.message } },
);
