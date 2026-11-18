import type { NotificationParams, NotificationType } from '../../database/schema/notifications.js';
import type { Role } from '../../database/schema/users.js';
import { composeMail } from '../../mail/compose.js';
import type { MailMessage } from '../../mail/index.js';
import { clinicDateTime, CLINIC_TIME_ZONE } from '../../lib/time.js';
import type { Recipient, Reminder } from './email-notifications.repository.js';

const AREAS: Record<Role, string> = { patient: '/paciente', doctor: '/medico', admin: '/admin' };

const CANCELLERS: Record<string, string> = {
  patient: ' pelo paciente',
  doctor: ' pelo médico',
  admin: ' pela administração',
  system: ' pelo sistema',
};

const longDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: CLINIC_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const at = ({ startsAt }: NotificationParams) =>
  typeof startsAt === 'string' && !Number.isNaN(Date.parse(startsAt)) ? ` de ${clinicDateTime.format(new Date(startsAt))}` : '';

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? '';

interface Notice {
  subject: string;
  body: (params: NotificationParams, role: Role) => string;
  path: (bookingId: string | null, role: Role) => string;
  label: string;
}

const agenda = { path: () => '/medico/agenda', label: 'Abrir a agenda' };
const bookingsPage = { path: () => '/paciente/agendamentos', label: 'Ver meus agendamentos' };

const NOTICES: Record<NotificationType, Notice> = {
  appointment_requested: {
    subject: 'Novo pedido de consulta',
    body: (params) => `Há um pedido de consulta${at(params)} aguardando sua confirmação.`,
    ...agenda,
  },
  appointment_rescheduled: {
    subject: 'Pedido de consulta reagendado',
    body: (params) => `O paciente pediu um novo horário: consulta${at(params)}.`,
    ...agenda,
  },
  appointment_cancelled_by_patient: {
    subject: 'Consulta cancelada pelo paciente',
    body: (params) => `A consulta${at(params)} foi cancelada pelo paciente.`,
    ...agenda,
  },
  appointment_confirmed: {
    subject: 'Consulta confirmada',
    body: (params) => `Sua consulta${at(params)} foi confirmada pelo médico.`,
    ...bookingsPage,
  },
  appointment_cancelled: {
    subject: 'Agendamento cancelado',
    body: (params, role) =>
      `O agendamento${at(params)} foi cancelado${CANCELLERS[String(params.cancelledByRole)] ?? ''}.${role === 'patient' ? ' Você pode agendar outro horário quando quiser.' : ''}`,
    path: (_bookingId, role) => (role === 'patient' ? bookingsPage.path() : agenda.path()),
    label: 'Ver os agendamentos',
  },
  appointment_expired: {
    subject: 'Pedido de consulta não confirmado',
    body: (params) => `O pedido de consulta${at(params)} não foi confirmado a tempo. Escolha outro horário.`,
    path: () => '/paciente/consultas/nova',
    label: 'Agendar consulta',
  },
  exam_result_available: {
    subject: 'Resultado de exame disponível',
    body: (params) => `O resultado do seu exame${at(params)} já pode ser consultado.`,
    path: (bookingId) => (bookingId ? `/paciente/exames/${bookingId}/resultado` : '/paciente/agendamentos'),
    label: 'Ver o resultado',
  },
  user_registered: {
    subject: 'Nova conta no Saúde+',
    body: () => 'Uma nova pessoa criou uma conta de paciente no Saúde+.',
    path: () => '/admin/usuarios',
    label: 'Ver usuários',
  },
};

const footerFor = (appUrl: string, role: Role) =>
  `Você recebe este e-mail porque este aviso está ligado no seu perfil. Para parar, desligue em ${appUrl}${AREAS[role]}/perfil.`;

export function noticeEmail(
  type: NotificationType,
  params: NotificationParams,
  bookingId: string | null,
  role: Role,
  recipient: Recipient,
  appUrl: string,
): MailMessage {
  const notice = NOTICES[type];
  return composeMail({
    to: recipient.email,
    subject: `${notice.subject} · Saúde+`,
    paragraphs: [`Olá, ${firstName(recipient.fullName)}.`, notice.body(params, role)],
    link: { href: `${appUrl}${notice.path(bookingId, role)}`, label: notice.label },
    footer: footerFor(appUrl, role),
  });
}

export function reminderEmail(reminder: Reminder, appUrl: string): MailMessage {
  const what = reminder.kind === 'exam' ? 'seu exame' : `sua consulta com ${reminder.doctorName ?? 'o médico'}`;
  return composeMail({
    to: reminder.email,
    subject: `Lembrete do seu ${reminder.kind === 'exam' ? 'exame' : 'agendamento'} · Saúde+`,
    paragraphs: [
      `Olá, ${firstName(reminder.fullName)}.`,
      `Lembrete: ${what} é ${longDate.format(reminder.startsAt)}, na ${reminder.unitName} (${reminder.unitAddress}).`,
      'Chegue 15 minutos antes e leve um documento com foto.',
    ],
    link: { href: `${appUrl}/paciente/agendamentos`, label: 'Ver meus agendamentos' },
    footer: footerFor(appUrl, 'patient'),
  });
}
