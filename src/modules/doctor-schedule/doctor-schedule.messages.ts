import { MAX_BOOKING_HORIZON_DAYS } from '../catalog/catalog.model.js';

export const scheduleMessages = {
  profileMissing: 'Esta conta ainda não tem perfil médico.',
  overlap: { code: 'OVERLAP', message: 'Esta faixa se sobrepõe a outra do mesmo dia.' },
  outsideUnitHours: { code: 'OUTSIDE_UNIT_HOURS', message: 'Esta faixa fica fora do horário da unidade.' },
  timeOffMissing: 'Esta data não está bloqueada.',
  pastDate: { code: 'PAST_DATE', field: 'date', message: 'Escolha hoje ou uma data futura.' },
  tooFar: {
    code: 'DATE_TOO_FAR',
    field: 'date',
    message: `Escolha uma data em até ${MAX_BOOKING_HORIZON_DAYS} dias.`,
  },
  timeOffExists: { code: 'TIME_OFF_EXISTS', field: 'date', message: 'Esta data já está bloqueada.' },
};
