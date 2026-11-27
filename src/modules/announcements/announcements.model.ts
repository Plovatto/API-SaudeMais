import '../../docs/zod-extend.js';
import { z } from 'zod';
import {
  announcementSeverities,
  MAX_ANNOUNCEMENT_BODY,
  MAX_ANNOUNCEMENT_TITLE,
} from '../../database/schema/announcements.js';
import { roles } from '../../database/schema/users.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';
import { boundedText } from '../../lib/text.js';
import { areaQuery } from '../notifications/notifications.model.js';

export const MAX_VISIBLE_ANNOUNCEMENTS = 5;

export const announcementStatuses = ['scheduled', 'active', 'ended'] as const;
export type AnnouncementStatus = (typeof announcementStatuses)[number];

export const endBeforeStart = { path: ['endsAt'], message: 'O fim precisa ser depois do início.' };

const instant = (description: string, example: string) =>
  z.iso.datetime({ offset: true, error: 'Use data e hora no formato ISO 8601.' }).openapi({ description, example });

const fields = {
  title: boundedText('O título', 1, MAX_ANNOUNCEMENT_TITLE).openapi({ example: 'Manutenção programada' }),
  body: boundedText('O texto', 1, MAX_ANNOUNCEMENT_BODY, { multiline: true }).openapi({
    description: 'Texto simples, exibido como está, sem formatação.',
    example: 'O sistema ficará fora do ar no sábado, das 2h às 4h.',
  }),
  severity: z.enum(announcementSeverities, { error: 'Escolha a gravidade: info, warning ou critical.' }).openapi({
    description: 'Gravidade: `info`, `warning` ou `critical`. Comunicados críticos aparecem primeiro.',
    example: 'info',
  }),
  audienceRoles: z
    .array(z.enum(roles, { error: 'Escolha os perfis: patient, doctor ou admin.' }))
    .min(1, 'Escolha ao menos um perfil.')
    .refine((values) => new Set(values).size === values.length, 'Não repita perfis.')
    .openapi({ description: 'Perfis que veem o comunicado, sem repetição.', example: ['patient', 'doctor'] }),
  startsAt: instant('Quando o comunicado passa a aparecer. Sem ele, agora.', '2026-11-28T12:00:00.000Z'),
  endsAt: instant('Quando deixa de aparecer; precisa ser depois do início.', '2026-11-29T12:00:00.000Z'),
};

const closesAfterOpening = ({ startsAt, endsAt }: { startsAt?: string | undefined; endsAt?: string | null | undefined }) =>
  !startsAt || !endsAt || Date.parse(endsAt) > Date.parse(startsAt);

export const createAnnouncementSchema = registry.register(
  'CreateAnnouncementRequest',
  z
    .strictObject({
      title: fields.title,
      body: fields.body,
      severity: fields.severity.default('info'),
      audienceRoles: fields.audienceRoles,
      startsAt: fields.startsAt.optional(),
      endsAt: fields.endsAt.nullable().optional(),
    })
    .refine(closesAfterOpening, endBeforeStart)
    .openapi({
      example: {
        title: 'Manutenção programada',
        body: 'O sistema ficará fora do ar no sábado, das 2h às 4h.',
        severity: 'warning',
        audienceRoles: ['patient', 'doctor'],
        startsAt: '2026-11-28T12:00:00.000Z',
        endsAt: '2026-11-29T12:00:00.000Z',
      },
    }),
);

export const updateAnnouncementSchema = registry.register(
  'UpdateAnnouncementRequest',
  z
    .strictObject({
      title: fields.title.optional(),
      body: fields.body.optional(),
      severity: fields.severity.optional(),
      audienceRoles: fields.audienceRoles.optional(),
      startsAt: fields.startsAt.optional(),
      endsAt: fields.endsAt.nullable().optional().openapi({
        description: 'Quando deixa de aparecer; `null` remove o fim. Precisa ser depois do início.',
      }),
    })
    .refine((data) => Object.values(data).some((value) => value !== undefined), {
      message: 'Envie pelo menos um campo para alterar.',
    })
    .refine(closesAfterOpening, endBeforeStart)
    .openapi({ example: { severity: 'critical', endsAt: null } }),
);

export const announcementsQuery = paginationQuery.extend({
  status: z.enum(announcementStatuses).optional().openapi({
    description: 'Só os agendados (`scheduled`), no ar agora (`active`) ou encerrados (`ended`).',
  }),
});

export const visibleQuery = areaQuery;

export const announcementSchema = registry.register(
  'Announcement',
  z.object({
    id: z.uuid(),
    title: z.string().openapi({ example: 'Manutenção programada' }),
    body: z.string().openapi({ example: 'O sistema ficará fora do ar no sábado, das 2h às 4h.' }),
    severity: z.enum(announcementSeverities),
    audienceRoles: z.array(z.enum(roles)),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    status: z.enum(announcementStatuses).openapi({
      description: '`scheduled` antes do início, `active` no ar, `ended` depois do fim. Calculado na hora da consulta.',
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
);

export const announcementPageSchema = registry.register('AnnouncementPage', paginatedSchema(announcementSchema));

const visibleAnnouncementSchema = registry.register(
  'VisibleAnnouncement',
  z.object({
    id: z.uuid(),
    title: z.string().openapi({ example: 'Manutenção programada' }),
    body: z.string().openapi({ example: 'O sistema ficará fora do ar no sábado, das 2h às 4h.' }),
    severity: z.enum(announcementSeverities),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
  }),
);

export const visibleAnnouncementsSchema = registry.register(
  'VisibleAnnouncements',
  z.object({ items: z.array(visibleAnnouncementSchema) }),
);

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type AnnouncementsQuery = z.infer<typeof announcementsQuery>;
export type Announcement = z.infer<typeof announcementSchema>;
export type VisibleAnnouncement = z.infer<typeof visibleAnnouncementSchema>;
