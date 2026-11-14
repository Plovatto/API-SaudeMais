import '../../docs/zod-extend.js';
import { z } from 'zod';
import { notificationTypes } from '../../database/schema/notifications.js';
import { roles } from '../../database/schema/users.js';
import { registry } from '../../docs/registry.js';
import { paginatedSchema, paginationQuery } from '../../lib/pagination.js';

export const areaQuery = z.strictObject({
  role: z.enum(roles, { error: 'Informe o perfil da área aberta.' }).openapi({
    description: 'Perfil da área aberta no cliente; precisa ser um perfil da conta.',
    example: 'patient',
  }),
});

export const notificationsQuery = paginationQuery.extend(areaQuery.shape);

export const notificationSchema = registry.register(
  'Notification',
  z.object({
    id: z.uuid(),
    type: z.enum(notificationTypes).openapi({ description: 'Tipo do aviso; o cliente monta o texto a partir dele.' }),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).openapi({
      description:
        'Dados para montar o texto. Em `user_registered`, `fullName` é o nome atual da conta, lido na hora. Nunca traz observações, motivos nem resultados de exame.',
      example: { userId: '019a8f2e-7c41-7d2a-9b1e-3f5a6c7d8e9f', fullName: 'Ana Maria Silva' },
    }),
    bookingId: z.uuid().nullable().openapi({ description: 'Agendamento do aviso; nulo só em `user_registered`.' }),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  }),
);

export const notificationPageSchema = registry.register('NotificationPage', paginatedSchema(notificationSchema));

export const unreadCountSchema = registry.register(
  'UnreadNotificationCount',
  z.object({ count: z.number().int().openapi({ example: 3 }) }),
);

export type Area = z.infer<typeof areaQuery> & { userId: string };
export type NotificationView = z.infer<typeof notificationSchema>;
