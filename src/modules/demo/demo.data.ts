import type { ExamKind } from '../../database/schema/catalog.js';
import { WORKDAYS } from '../../lib/week.js';

export interface SpecialtySeed {
  name: string;
  council: string;
  appointmentDurationMin: number;
}

export interface UnitSeed {
  name: string;
  address: string;
  phone: string;
  hours: { weekday: number; openMin: number; closeMin: number }[];
}

export interface ExamTypeSeed {
  code: string;
  name: string;
  kind: ExamKind;
  durationMin: number;
  preparationNotes: string | null;
}

export interface DoctorProfileTarget {
  specialty: string;
  unit: string;
  registryNumber: string;
  registryUf: string;
}

const weekdays = (openMin: number, closeMin: number) => WORKDAYS.map((weekday) => ({ weekday, openMin, closeMin }));

export const SPECIALTIES: readonly SpecialtySeed[] = [
  { name: 'Clínica Geral', council: 'CRM', appointmentDurationMin: 30 },
  { name: 'Cardiologia', council: 'CRM', appointmentDurationMin: 30 },
  { name: 'Dermatologia', council: 'CRM', appointmentDurationMin: 20 },
  { name: 'Nutrição', council: 'CRN', appointmentDurationMin: 40 },
  { name: 'Psicologia', council: 'CRP', appointmentDurationMin: 50 },
];

export const UNITS: readonly UnitSeed[] = [
  {
    name: 'Unidade Central',
    address: 'Rua das Flores, 123 - Centro, São Paulo - SP',
    phone: '+551133334444',
    hours: [...weekdays(7 * 60, 19 * 60), { weekday: 6, openMin: 8 * 60, closeMin: 12 * 60 }],
  },
  {
    name: 'Unidade Sul',
    address: 'Av. Ipiranga, 987 - Zona Sul, São Paulo - SP',
    phone: '+551155556666',
    hours: weekdays(8 * 60, 18 * 60),
  },
];

export const EXAM_TYPES: readonly ExamTypeSeed[] = [
  { code: 'hemograma', name: 'Hemograma', kind: 'lab', durationMin: 10, preparationNotes: null },
  {
    code: 'glicemia',
    name: 'Glicemia',
    kind: 'lab',
    durationMin: 10,
    preparationNotes: 'Jejum de 8 horas. Água é liberada.',
  },
  {
    code: 'colesterol',
    name: 'Colesterol',
    kind: 'lab',
    durationMin: 10,
    preparationNotes: 'Jejum de 12 horas e nada de álcool nas 72 horas anteriores.',
  },
  {
    code: 'ultrassom',
    name: 'Ultrassom',
    kind: 'imaging',
    durationMin: 30,
    preparationNotes: 'Para ultrassom abdominal, jejum de 6 horas.',
  },
  { code: 'raio_x', name: 'Raio-X', kind: 'imaging', durationMin: 15, preparationNotes: 'Retire objetos de metal.' },
];

export const OFFERS: readonly { unit: string; examType: string; capacityPerSlot: number }[] = [
  { unit: 'Unidade Central', examType: 'hemograma', capacityPerSlot: 4 },
  { unit: 'Unidade Central', examType: 'glicemia', capacityPerSlot: 4 },
  { unit: 'Unidade Central', examType: 'colesterol', capacityPerSlot: 4 },
  { unit: 'Unidade Central', examType: 'ultrassom', capacityPerSlot: 2 },
  { unit: 'Unidade Central', examType: 'raio_x', capacityPerSlot: 2 },
  { unit: 'Unidade Sul', examType: 'hemograma', capacityPerSlot: 3 },
  { unit: 'Unidade Sul', examType: 'glicemia', capacityPerSlot: 3 },
  { unit: 'Unidade Sul', examType: 'ultrassom', capacityPerSlot: 1 },
];

export const DEMO_DOCTOR_PROFILE: DoctorProfileTarget = {
  specialty: 'Clínica Geral',
  unit: 'Unidade Central',
  registryNumber: '999999',
  registryUf: 'SP',
};

export const SAMPLE_DOCTORS: readonly (DoctorProfileTarget & { fullName: string; email: string })[] = [
  {
    fullName: 'Dra. Ana Ferreira',
    email: 'ana.ferreira@saudemais.test',
    specialty: 'Nutrição',
    unit: 'Unidade Central',
    registryNumber: '45210',
    registryUf: 'SP',
  },
  {
    fullName: 'Dr. Carlos Mendes',
    email: 'carlos.mendes@saudemais.test',
    specialty: 'Cardiologia',
    unit: 'Unidade Central',
    registryNumber: '98321',
    registryUf: 'SP',
  },
  {
    fullName: 'Dra. Beatriz Lima',
    email: 'beatriz.lima@saudemais.test',
    specialty: 'Dermatologia',
    unit: 'Unidade Sul',
    registryNumber: '77104',
    registryUf: 'SP',
  },
  {
    fullName: 'Dr. Rafael Costa',
    email: 'rafael.costa@saudemais.test',
    specialty: 'Psicologia',
    unit: 'Unidade Sul',
    registryNumber: '61850',
    registryUf: 'SP',
  },
];

export const SAMPLE_PATIENTS: readonly { fullName: string; email: string }[] = [
  { fullName: 'Andreia Soares', email: 'andreia.soares@saudemais.test' },
  { fullName: 'Beatriz Neves', email: 'beatriz.neves@saudemais.test' },
  { fullName: 'Lucas Oliveira', email: 'lucas.oliveira@saudemais.test' },
  { fullName: 'Paulo Silva', email: 'paulo.silva@saudemais.test' },
];
