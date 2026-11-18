import type { Role } from '../../database/schema/users.js';

export interface SeedAccount {
  fullName: string;
  email: string;
  password: string;
  roles: Role[];
}

export const EXAMPLE_PATIENT: SeedAccount = {
  fullName: 'Ana Maria Silva',
  email: 'paciente@saudemais.test',
  password: 'paciente-demo-123',
  roles: ['patient'],
};

export const EXAMPLE_DOCTOR: SeedAccount = {
  fullName: 'Dr. João Silveira',
  email: 'medico@saudemais.test',
  password: 'medico-demo-123',
  roles: ['patient'],
};
