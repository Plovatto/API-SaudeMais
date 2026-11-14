import '../../docs/zod-extend.js';
import { z } from 'zod';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/params.js';
import { searchText } from '../../lib/search.js';
import { DAY } from '../../lib/time.js';

export const MAX_AVAILABILITY_DAYS = 31;

export const doctorsQuery = paginationQuery.extend({
  specialtyId: uuidParam.optional().openapi({ description: 'Só médicos desta especialidade.' }),
  search: searchText.openapi({ description: 'Parte do nome do médico, sem distinguir acentos nem maiúsculas.' }),
});

export const doctorSchema = registry.register(
  'Doctor',
  z.object({
    id: z.uuid(),
    fullName: z.string().openapi({ example: 'Dra. Ana Ferreira' }),
    specialty: z.object({
      id: z.uuid(),
      name: z.string().openapi({ example: 'Nutrição' }),
      council: z.string().openapi({ example: 'CRN' }),
    }),
    unit: z.object({
      id: z.uuid(),
      name: z.string().openapi({ example: 'Unidade Central' }),
      address: z.string().openapi({ example: 'Rua das Flores, 123 - Centro, São Paulo - SP' }),
      phone: z.string().openapi({ example: '+551133334444' }),
    }),
    registry: z.object({
      number: z.string().openapi({ example: '45210' }),
      uf: z.string().openapi({ example: 'SP' }),
    }),
  }),
);

export const doctorPageSchema = registry.register('DoctorPage', paginatedSchema(doctorSchema));

const civilDay = z.iso.date('Use uma data no formato AAAA-MM-DD.');

export const availabilityQuery = z
  .strictObject({
    from: civilDay.openapi({ description: 'Primeiro dia, no fuso de São Paulo.', example: '2026-11-23' }),
    to: civilDay.openapi({ description: 'Último dia, incluído.', example: '2026-11-27' }),
  })
  .refine(({ from, to }) => to >= from, {
    path: ['to'],
    message: 'A data final precisa ser igual ou posterior à inicial.',
  })
  .refine(({ from, to }) => Date.parse(to) - Date.parse(from) < MAX_AVAILABILITY_DAYS * DAY, {
    path: ['to'],
    message: `Consulte no máximo ${MAX_AVAILABILITY_DAYS} dias por vez.`,
  });

const slotSchema = z.object({
  startsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:00:00.000Z' }),
  endsAt: z.iso.datetime().openapi({ example: '2026-11-23T11:30:00.000Z' }),
});

export const availabilitySchema = registry.register(
  'DoctorAvailability',
  z.object({
    days: z
      .array(
        z.object({
          date: z.iso.date().openapi({ description: 'Dia no fuso de São Paulo.', example: '2026-11-23' }),
          slots: z.array(slotSchema).openapi({ description: 'Vagas livres do dia, em ordem.' }),
        }),
      )
      .openapi({ description: 'Só os dias do período com ao menos uma vaga livre, em ordem.' }),
  }),
);

export type DoctorsQuery = z.infer<typeof doctorsQuery>;
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;
export type Doctor = z.infer<typeof doctorSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
