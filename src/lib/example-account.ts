import { AppError } from './app-error.js';

export const EXAMPLE_ACCOUNT_ID = '0198f0c0-0000-7000-8000-000000000c01';

export const EXAMPLE_ACCOUNT_RESTRICTED_MESSAGE =
  'A conta de exemplo não pode dar acesso de administrador nem criar integrações.';

export function refuseExampleEscalation(actorId: string | null): void {
  if (actorId === EXAMPLE_ACCOUNT_ID) {
    throw new AppError(403, 'EXAMPLE_ACCOUNT_RESTRICTED', EXAMPLE_ACCOUNT_RESTRICTED_MESSAGE);
  }
}
