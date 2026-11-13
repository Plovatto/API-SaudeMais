import type { FieldConflict } from '../../lib/app-error.js';

export const userNotFound = 'Usuário não encontrado.';
export const doctorProfileNotFound = 'Esta conta não tem perfil médico.';

export const adminConflicts = {
  selfOrLastAdmin: {
    code: 'SELF_OR_LAST_ADMIN',
    field: '_root',
    message:
      'Você não pode desativar nem tirar o perfil de administrador da própria conta, nem deixar o sistema sem administradores.',
  },
  inactive: { code: 'USER_INACTIVE', field: '_root', message: 'A conta está desativada; reative-a antes.' },
  registryTaken: {
    code: 'REGISTRY_TAKEN',
    field: 'registryNumber',
    message: 'Este registro profissional já pertence a outro médico.',
  },
  profileExists: { code: 'DOCTOR_PROFILE_EXISTS', field: '_root', message: 'Esta conta já tem perfil médico.' },
  futureAppointments: {
    code: 'HAS_FUTURE_APPOINTMENTS',
    field: '_root',
    message: 'O médico tem consultas futuras; elas precisam ser canceladas antes da mudança.',
  },
  resetNotSent: {
    code: 'RESET_NOT_SENT',
    field: '_root',
    message: 'Um link foi enviado há pouco ou o limite do dia foi atingido. Tente mais tarde.',
  },
} satisfies Record<string, FieldConflict>;

export const unavailable = {
  specialty: { code: 'SPECIALTY_UNAVAILABLE', field: 'specialtyId', message: 'Escolha uma especialidade ativa.' },
  unit: { code: 'UNIT_UNAVAILABLE', field: 'unitId', message: 'Escolha uma unidade ativa.' },
} satisfies Record<string, FieldConflict>;
