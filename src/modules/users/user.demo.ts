import type { Role } from '../../database/schema/users.js';

export interface SeedAccount {
  fullName: string;
  email: string;
  password: string;
  roles: Role[];
  isProtected: boolean;
}

export const DEMO_ACCOUNTS: readonly SeedAccount[] = [
  {
    fullName: 'Ana Maria Silva',
    email: 'paciente@saudemais.test',
    password: 'paciente-demo-123',
    roles: ['patient'],
    isProtected: true,
  },
];

const demoEmails = new Set(DEMO_ACCOUNTS.map((account) => account.email));

export function isDemoEmail(email: string): boolean {
  return demoEmails.has(email);
}
