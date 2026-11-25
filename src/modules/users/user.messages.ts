import type { FieldConflict } from '../../lib/app-error.js';

export const sessionNotFound = 'Sessão não encontrada.';

export const currentSession = {
  code: 'CURRENT_SESSION',
  message: 'Esta é a sessão em uso. Para encerrá-la, saia da conta.',
};

export const invalidCredentials = { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha incorretos.' };

export const userInactive = { code: 'USER_INACTIVE', message: 'Esta conta está desativada.' };

export const invalidCurrentPassword = {
  code: 'INVALID_CURRENT_PASSWORD',
  field: 'currentPassword',
  message: 'A senha atual está incorreta.',
} satisfies FieldConflict;

export const invalidBirthDate = 'Informe uma data de nascimento válida.';

export const birthDateInFuture = { birthDate: 'A data de nascimento não pode ser no futuro.' };

export const MAX_AGE_YEARS = 120;

export const birthDateTooOld = {
  birthDate: `Informe uma data de nascimento de até ${MAX_AGE_YEARS} anos atrás.`,
};

export const emailConflicts = {
  users_email_key: { code: 'EMAIL_TAKEN', field: 'email', message: 'Este e-mail já está cadastrado.' },
} satisfies Record<string, FieldConflict>;
