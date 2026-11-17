import { composeMail } from '../../mail/compose.js';
import type { MailMessage } from '../../mail/index.js';

export function resetEmail(to: string, link: string, minutes: number): MailMessage {
  return composeMail({
    to,
    subject: 'Redefinição de senha do Saúde+',
    paragraphs: [
      'Recebemos um pedido para redefinir a senha da sua conta no Saúde+.',
      `Abra o link abaixo em até ${minutes} minutos para criar uma nova senha.`,
    ],
    link: { href: link, label: 'Redefinir minha senha' },
    footer: 'Se você não pediu, ignore este e-mail. Sua senha continua a mesma.',
  });
}
