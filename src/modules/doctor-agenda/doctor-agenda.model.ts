import '../../docs/zod-extend.js';
import { z } from 'zod';
import { countSchema, nullableRef } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';
import { searchText } from '../../lib/search.js';
import { appointmentSchema, doctorActionsSchema, person } from '../appointments/appointments.model.js';
import { civilDay, endNotBeforeStart } from '../doctors/doctors.model.js';
import { notificationSchema } from '../notifications/notifications.model.js';

export const agendaTabs = ['pending', 'confirmed', 'awaiting', 'history', 'all'] as const;

export const doctorAppointmentsQuery = paginationQuery
  .extend({
    tab: z
      .enum(agendaTabs, {
        error: 'Escolha entre a confirmar, confirmadas, aguardando registro, histórico e todas.',
      })
      .default('pending')
      .openapi({
        description:
          'Aba da agenda: a confirmar (`pending`, pedidos pendentes que ainda não começaram) e confirmadas (`confirmed`, confirmadas que ainda não começaram) e aguardando registro (`awaiting`, confirmadas que já começaram), das mais próximas para as mais distantes; histórico (`history`, todo o resto, inclusive as confirmadas que já começaram e aguardam registro), das mais recentes para as mais antigas; todas (`all`, em qualquer situação), das mais antigas para as mais recentes.',
      }),
    from: civilDay.optional().openapi({
      description: 'Só consultas que começam neste dia ou depois, no fuso de São Paulo.',
      example: '2026-11-23',
    }),
    to: civilDay.optional().openapi({
      description:
        'Só consultas que começam neste dia ou antes, incluído, no fuso de São Paulo. Não pode ser anterior a `from`.',
      example: '2026-11-29',
    }),
    search: searchText.openapi({
      description: 'Parte do nome do paciente, sem distinguir acentos nem maiúsculas.',
      example: 'joao',
    }),
  })
  .refine(({ from, to }) => !from || !to || to >= from, endNotBeforeStart);

export const doctorAppointmentSchema = registry.register(
  'DoctorAppointment',
  appointmentSchema
    .pick({
      id: true,
      visitType: true,
      startsAt: true,
      endsAt: true,
      notes: true,
      specialty: true,
      unit: true,
      cancellation: true,
    })
    .extend({
      status: appointmentSchema.shape.status.openapi({
        description:
          'Situação da consulta. Pedido pendente cujo horário já chegou aparece como `expired`; consulta `confirmed` no histórico já começou e aguarda o registro do médico.',
      }),
      patient: person.extend({
        phone: z.string().nullable().openapi({
          description:
            'Telefone do paciente; só em consultas pendentes, confirmadas, concluídas ou com falta registrada, e nulo nas canceladas e nas não confirmadas a tempo.',
          example: '+5511987654321',
        }),
      }),
      actions: doctorActionsSchema,
    }),
);

const countsSchema = z
  .object({
    pending: countSchema('Pedidos a confirmar.', 2),
    confirmed: countSchema('Confirmadas que ainda não começaram.', 5),
    awaiting: countSchema('Confirmadas que já começaram e aguardam registro; também contam no histórico.', 1),
    history: countSchema('Consultas no histórico.', 12),
  })
  .openapi({ description: 'Totais das abas da agenda, sem os filtros `from`, `to` e `search`.' });

export const doctorAppointmentPageSchema = registry.register(
  'DoctorAppointmentPage',
  paginatedSchema(doctorAppointmentSchema).extend({ counts: countsSchema }),
);

export const doctorHomeSchema = registry.register(
  'DoctorHome',
  z.object({
    today: z
      .object({
        date: z.iso.date().openapi({ description: 'Dia de hoje no fuso de São Paulo.', example: '2026-11-20' }),
        total: countSchema('Todas as consultas de hoje.', 8),
        pending: countSchema('Pedidos de hoje ainda a confirmar.', 1),
        confirmed: countSchema('Confirmadas de hoje que ainda não começaram.', 4),
        awaitingRecord: countSchema('Confirmadas de hoje que já começaram e aguardam registro.', 1),
        completed: countSchema('Concluídas hoje.', 1),
        noShow: countSchema('Faltas de hoje.', 0),
        cancelled: countSchema('Canceladas de hoje.', 1),
        expired: countSchema('Pedidos de hoje que não foram confirmados a tempo.', 0),
      })
      .openapi({ description: 'Resumo das consultas de hoje no fuso de São Paulo, pela situação atual.' }),
    pending: z
      .array(doctorAppointmentSchema)
      .openapi({ description: 'Os próximos pedidos a confirmar, do mais próximo para o mais distante.' }),
    awaitingRecord: z
      .array(doctorAppointmentSchema)
      .openapi({ description: 'As consultas mais antigas que aguardam registro, da mais antiga para a mais recente.' }),
    counts: countsSchema,
    lastNotification: nullableRef(notificationSchema).openapi({
      description: 'O aviso mais recente do perfil de médico, lido ou não.',
    }),
  }),
);

export type AgendaTab = (typeof agendaTabs)[number];
export type DoctorAppointmentsQuery = z.infer<typeof doctorAppointmentsQuery>;
export type DoctorAppointmentPage = z.infer<typeof doctorAppointmentPageSchema>;
export type DoctorHome = z.infer<typeof doctorHomeSchema>;
