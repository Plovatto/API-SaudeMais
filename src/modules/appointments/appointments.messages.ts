import type { FieldConflict } from '../../lib/app-error.js';

export const ACTIVE_LIMIT = 5;

export const appointmentNotFound = 'Consulta não encontrada.';

export const appointmentConflicts = {
  slotTaken: {
    code: 'SLOT_TAKEN',
    field: 'startsAt',
    message: 'Este horário acabou de ser ocupado. Escolha outra vaga.',
  },
  patientConflict: {
    code: 'PATIENT_CONFLICT',
    field: 'startsAt',
    message: 'Você já tem um agendamento que coincide com este horário.',
  },
  invalidState: {
    code: 'INVALID_STATE',
    field: '_root',
    message: 'Esta consulta mudou ou não pode mais ser cancelada. Atualize a página.',
  },
} satisfies Record<string, FieldConflict>;

export const appointmentRules = {
  outsideAvailability: {
    code: 'OUTSIDE_AVAILABILITY',
    field: 'startsAt',
    message: 'Este horário não é uma vaga do médico. Escolha uma vaga da lista.',
  },
  activeLimit: {
    code: 'ACTIVE_LIMIT',
    field: '_root',
    message: `Você já tem ${ACTIVE_LIMIT} agendamentos ativos. Cancele um ou aguarde a data de um deles para marcar outro.`,
  },
  specialtyMismatch: {
    code: 'SPECIALTY_MISMATCH',
    field: 'specialtyId',
    message: 'Este médico não atende a especialidade escolhida.',
  },
  reasonRequired: {
    code: 'REASON_REQUIRED',
    field: 'reason',
    message: 'Informe o motivo do cancelamento.',
  },
  selfBooking: {
    code: 'SELF_BOOKING',
    field: 'doctorId',
    message: 'Você não pode marcar uma consulta com você mesmo.',
  },
} satisfies Record<string, FieldConflict>;
