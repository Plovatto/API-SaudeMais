import '../../docs/zod-extend.js';
import { z } from 'zod';
import { nullableRef } from '../../docs/common-schemas.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';
import { appointmentSchema, person } from '../appointments/appointments.model.js';
import { civilDay } from '../doctors/doctors.model.js';
import { notificationSchema } from '../notifications/notifications.model.js';

export const agendaTabs = ['pending', 'confirmed', 'awaiting', 'history'] as const;

const total = (description: string, example: number) => z.int().nonnegative().openapi({ description, example });

export const doctorAppointmentsQuery = paginationQuery.extend({
  tab: z
    .enum(agendaTabs, { error: 'Escolha entre a confirmar, confirmadas, aguardando registro e histórico.' })
    .default('pending')
    .openapi({
      description:
        'Aba da agenda: a confirmar (`pending`, pedidos pendentes que ainda não começaram) e confirmadas (`confirmed`, confirmadas que ainda não começaram) e aguardando registro (`awaiting`, confirmadas que já começaram), das mais próximas para as mais distantes; histórico (`history`, todo o resto, inclusive as confirmadas que já começaram e aguardam registro), das mais recentes para as mais antigas.',
    }),
  from: civilDay.optional().openapi({
    description: 'Só consultas que começam neste dia ou depois, no fuso de São Paulo.',
    example: '2026-11-23',
  }),
});

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
      actions: z.object({
        canConfirm: z.boolean().openapi({
          description: 'Se o médico pode confirmar: pedido pendente que ainda não começou.',
          example: true,
        }),
        canCancel: z.boolean().openapi({
          description: 'Se o médico pode cancelar, com motivo: pendente ou confirmada que ainda não começou.',
          example: true,
        }),
      }),
    }),
);

const countsSchema = z
  .object({
    pending: total('Pedidos a confirmar.', 2),
    confirmed: total('Confirmadas que ainda não começaram.', 5),
    awaiting: total('Confirmadas que já começaram e aguardam registro; também contam no histórico.', 1),
    history: total('Consultas no histórico.', 12),
  })
  .openapi({ description: 'Totais das abas da agenda, sem os filtros.' });

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
        total: total('Todas as consultas de hoje.', 8),
        pending: total('Pedidos de hoje ainda a confirmar.', 1),
        confirmed: total('Confirmadas de hoje que ainda não começaram.', 4),
        awaitingRecord: total('Confirmadas de hoje que já começaram e aguardam registro.', 1),
        completed: total('Concluídas hoje.', 1),
        noShow: total('Faltas de hoje.', 0),
        cancelled: total('Canceladas de hoje.', 1),
        expired: total('Pedidos de hoje que não foram confirmados a tempo.', 0),
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
