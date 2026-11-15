import { errorResponse } from '../../docs/common-schemas.js';
import type { FieldConflict } from '../../lib/app-error.js';

export const ACTIVE_LIMIT = 5;

export const patientConflict: FieldConflict = {
  code: 'PATIENT_CONFLICT',
  field: 'startsAt',
  message: 'Você já tem um agendamento que coincide com este horário.',
};

export const activeLimit: FieldConflict = {
  code: 'ACTIVE_LIMIT',
  field: '_root',
  message: `Você já tem ${ACTIVE_LIMIT} agendamentos ativos. Cancele um ou aguarde a data de um deles para marcar outro.`,
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
