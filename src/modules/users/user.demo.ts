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

export const DEMO_DOCTOR: SeedAccount = {
  fullName: 'Dr. João Silveira',
  email: 'medico@saudemais.test',
  password: 'medico-demo-123',
  roles: ['patient', 'doctor'],
  isProtected: true,
};

const demoEmails = new Set([...DEMO_ACCOUNTS, DEMO_DOCTOR].map((account) => account.email));

export function isDemoEmail(email: string): boolean {
  return demoEmails.has(email);
}
