import type { FieldConflict } from '../../lib/app-error.js';

export const sessionNotFound = 'Sessão não encontrada.';

export const currentSession = {
  code: 'CURRENT_SESSION',
  message: 'Esta é a sessão em uso. Para encerrá-la, saia da conta.',
};

export const invalidBirthDate = 'Informe uma data de nascimento válida.';

export const birthDateInFuture = { birthDate: 'A data de nascimento não pode ser no futuro.' };

export const emailConflicts = {
  users_email_key: { code: 'EMAIL_TAKEN', field: 'email', message: 'Este e-mail já está cadastrado.' },
} satisfies Record<string, FieldConflict>;
