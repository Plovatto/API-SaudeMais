import '../../docs/zod-extend.js';
import { z } from 'zod';
import { emailTopics, type EmailTopic } from '../../database/schema/email-preferences.js';
import type { NotificationType } from '../../database/schema/notifications.js';
import { roles, type Role } from '../../database/schema/users.js';
import { registry } from '../../docs/registry.js';

export const TOPIC_ROLES: Record<EmailTopic, Role> = {
  booking_reminder: 'patient',
  booking_decision: 'patient',
  exam_result: 'patient',
  appointment_request: 'doctor',
  appointment_cancellation: 'doctor',
  user_registration: 'admin',
};

const NOTIFICATION_TOPICS: Record<Role, Partial<Record<NotificationType, EmailTopic>>> = {
  patient: {
    appointment_confirmed: 'booking_decision',
    appointment_cancelled: 'booking_decision',
    appointment_expired: 'booking_decision',
    exam_result_available: 'exam_result',
  },
  doctor: {
    appointment_requested: 'appointment_request',
    appointment_rescheduled: 'appointment_request',
    appointment_cancelled_by_patient: 'appointment_cancellation',
    appointment_cancelled: 'appointment_cancellation',
  },
  admin: { user_registered: 'user_registration' },
};

export const topicOf = (type: NotificationType, role: Role): EmailTopic | undefined => NOTIFICATION_TOPICS[role][type];

export const topicsFor = (owned: readonly Role[]) => emailTopics.filter((topic) => owned.includes(TOPIC_ROLES[topic]));

const topic = z.enum(emailTopics).openapi({
  description:
    'Assunto do aviso: `booking_reminder` (lembrete cerca de 24 horas antes), `booking_decision` (confirmação, cancelamento ou pedido não confirmado), `exam_result` (resultado disponível), `appointment_request` (pedido novo ou reagendado), `appointment_cancellation` (consulta cancelada pelo paciente ou pela administração) e `user_registration` (conta nova).',
  example: 'booking_reminder',
});

export const emailPreferenceSchema = registry.register(
  'EmailPreference',
  z.object({
    topic,
    role: z.enum(roles).openapi({ description: 'Perfil a que o aviso pertence.', example: 'patient' }),
    enabled: z.boolean().openapi({ description: 'Se o e-mail é enviado. Sem escolha gravada, vale `true`.' }),
  }),
);

export const updateEmailPreferencesSchema = registry.register(
  'UpdateEmailPreferencesRequest',
  z.strictObject({
    preferences: z
      .array(z.strictObject({ topic, enabled: z.boolean() }))
      .min(1, 'Envie pelo menos uma preferência.')
      .max(emailTopics.length, `Envie no máximo ${emailTopics.length} preferências.`)
      .refine((items) => new Set(items.map((item) => item.topic)).size === items.length, 'Envie cada assunto uma vez.')
      .openapi({ example: [{ topic: 'booking_reminder', enabled: false }] }),
  }),
);

export const topicNotAvailable = {
  code: 'TOPIC_NOT_AVAILABLE',
  message: 'Este aviso não pertence a nenhum perfil da sua conta.',
};

export type EmailPreference = z.infer<typeof emailPreferenceSchema>;
export type UpdateEmailPreferencesInput = z.infer<typeof updateEmailPreferencesSchema>;
