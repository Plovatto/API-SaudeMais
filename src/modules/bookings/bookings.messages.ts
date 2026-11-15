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

export const notStarted: FieldConflict = {
  code: 'NOT_STARTED',
  field: '_root',
  message: 'Esta consulta ainda não começou. Conclua ou registre a falta a partir do horário de início.',
};
