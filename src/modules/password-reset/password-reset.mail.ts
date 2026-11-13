import type { MailMessage } from '../../mail/index.js';

export function resetEmail(to: string, link: string, minutes: number): MailMessage {
  const text = [
    'Recebemos um pedido para redefinir a senha da sua conta no Saúde+.',
    `Abra o link abaixo em até ${minutes} minutos para criar uma nova senha:`,
    link,
    'Se você não pediu, ignore este e-mail. Sua senha continua a mesma.',
  ].join('\n\n');
  const html = `<p>Recebemos um pedido para redefinir a senha da sua conta no Saúde+.</p>
<p>Abra o link abaixo em até ${minutes} minutos para criar uma nova senha:</p>
<p><a href="${link}">Redefinir minha senha</a></p>
<p>Se você não pediu, ignore este e-mail. Sua senha continua a mesma.</p>`;
  return { to, subject: 'Redefinição de senha do Saúde+', text, html };
}
