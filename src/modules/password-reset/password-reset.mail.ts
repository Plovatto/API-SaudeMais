import { composeMail } from '../../mail/compose.js';
import type { MailMessage } from '../../mail/index.js';

export function resetEmail(to: string, link: string, minutes: number): MailMessage {
  return composeMail({
    to,
    subject: 'Redefinição de senha do Saúde+',
    heading: 'Redefina sua senha',
    paragraphs: [
      'Recebemos um pedido para redefinir a senha da sua conta no Saúde+.',
      `Abra o link abaixo em até ${minutes} minutos para criar uma nova senha.`,
    ],
    link: { href: link, label: 'Redefinir minha senha' },
    footer: 'Se você não pediu, ignore este e-mail. Sua senha continua a mesma.',
  });
}

export function welcomeEmail(to: string, link: string, hours: number): MailMessage {
  return composeMail({
    to,
    subject: 'Sua conta no Saúde+ foi criada',
    heading: 'Sua conta está pronta',
    paragraphs: [
      'Sua conta no Saúde+ foi criada pela equipe da clínica com este e-mail.',
      `Abra o link abaixo em até ${hours} horas para criar sua senha e entrar.`,
    ],
    link: { href: link, label: 'Criar minha senha' },
    footer: 'Se o link vencer, toque em "Esqueceu a senha?" na tela de entrada para receber outro.',
  });
}
