import type { FieldConflict } from '../../lib/app-error.js';

export const examBookingNotFound = 'Exame não encontrado.';

export const examOfferNotFound = 'Este exame não está disponível nesta unidade.';

export const examConflicts = {
  noCapacity: {
    code: 'NO_CAPACITY',
    field: 'startsAt',
    message: 'Não há mais lugares neste horário. Escolha outra vaga.',
  },
  invalidState: {
    code: 'INVALID_STATE',
    field: '_root',
    message: 'Este exame mudou ou não pode mais ser cancelado. Atualize a página.',
  },
  notReschedulable: {
    code: 'INVALID_STATE',
    field: '_root',
    message: 'Este exame mudou ou não pode mais ser reagendado. Atualize a página.',
  },
} satisfies Record<string, FieldConflict>;

export const outsideExamAvailability: FieldConflict = {
  code: 'OUTSIDE_AVAILABILITY',
  field: 'startsAt',
  message: 'Este horário não é uma vaga do exame. Escolha uma vaga da lista.',
};
