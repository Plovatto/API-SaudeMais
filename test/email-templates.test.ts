import { describe, expect, it } from 'vitest';
import { composeMail } from '@/mail/compose.js';
import { topicOf } from '@/modules/email-notifications/email-notifications.model.js';
import { noticeEmail } from '@/modules/email-notifications/email-notifications.templates.js';

const APP = 'https://app.saudemais.test';
const recipient = { userId: 'u1', email: 'dra@email.com', fullName: 'Helena <b>Prado</b>' };

describe('composeMail', () => {
  it('escapes every piece of text that goes into the html', () => {
    const mail = composeMail({
      to: 'a@email.com',
      subject: 'Assunto',
      paragraphs: ['Olá, <script>alert(1)</script> & "amigos"'],
      link: { href: `${APP}/x?a=1&b="2"`, label: 'Abrir <link>' },
      footer: "Rua D'Ávila & Cia",
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&#60;script&#62;');
    expect(mail.html).toContain('href="https://app.saudemais.test/x?a=1&#38;b=&#34;2&#34;"');
    expect(mail.html).toContain('Rua D&#39;Ávila &#38; Cia');
    expect(mail.text).toContain('Olá, <script>alert(1)</script> & "amigos"');
  });
});

describe('mail layout', () => {
  const mail = composeMail({
    to: 'a@email.com',
    subject: 'Assunto',
    heading: 'Título <do> e-mail',
    paragraphs: ['Primeiro parágrafo.', 'Segundo parágrafo.'],
    link: { href: `${APP}/entrar`, label: 'Entrar agora' },
    footer: 'Rodapé do aviso.',
  });

  it('wraps every message in the same branded layout', () => {
    expect(mail.html).toContain('<!doctype html>');
    expect(mail.html).toContain('lang="pt-BR"');
    expect(mail.html).toContain('Saúde+');
    expect(mail.html).toContain('Sua saúde, seus horários, em um só lugar.');
    expect(mail.html).toContain('Rodapé do aviso.');
  });

  it('puts the heading, the paragraphs and the button in order', () => {
    const order = ['Título &#60;do&#62; e-mail', 'Primeiro parágrafo.', 'Segundo parágrafo.', 'Entrar agora'].map((part) =>
      mail.html.indexOf(part, mail.html.indexOf('<h1')),
    );
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows the brand logo and links the legal pages of the app the link points to', () => {
    expect(mail.attachments).toHaveLength(1);
    const logo = mail.attachments?.[0];
    expect(logo?.filename).toBe('email-logo.png');
    expect(logo?.content.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(mail.html).toContain(`src="cid:${logo?.cid}"`);
    expect(mail.html).toContain(`href="${APP}/privacidade"`);
    expect(mail.html).toContain(`href="${APP}/termos"`);
    expect(mail.html).toContain('Esta é uma mensagem automática.');
  });

  it('leaves out the legal links when the link has no web address', () => {
    const plain = composeMail({
      to: 'a@email.com',
      subject: 'Assunto',
      paragraphs: ['Texto.'],
      link: { href: 'mailto:a@email.com', label: 'Escrever' },
    });

    expect(plain.html).not.toContain('/privacidade');
  });

  it('keeps a plain text version with the heading and the link', () => {
    expect(mail.text).toBe(
      ['Título <do> e-mail', 'Primeiro parágrafo.', 'Segundo parágrafo.', `Entrar agora: ${APP}/entrar`, 'Rodapé do aviso.'].join('\n\n'),
    );
  });
});

describe('notification topics', () => {
  it('picks the topic from the notice and from who receives it', () => {
    expect(topicOf('appointment_cancelled', 'patient')).toBe('booking_decision');
    expect(topicOf('appointment_cancelled', 'doctor')).toBe('appointment_cancellation');
    expect(topicOf('appointment_requested', 'patient')).toBeUndefined();
    expect(topicOf('user_registered', 'admin')).toBe('user_registration');
  });

  it('sends a doctor the agenda link and doctor wording for a cancelled booking', () => {
    const mail = noticeEmail(
      'appointment_cancelled',
      { startsAt: '2026-11-23T13:00:00.000Z', cancelledByRole: 'admin' },
      'b1',
      'doctor',
      recipient,
      APP,
    );

    expect(mail.text).toContain('O agendamento de 23/11/2026, 10:00 foi cancelado pela administração.');
    expect(mail.text).not.toContain('Você pode agendar');
    expect(mail.text).toContain(`${APP}/medico/agenda`);
    expect(mail.text).toContain(`${APP}/medico/perfil`);
    expect(mail.html).toContain('Olá, Helena.');
  });
});
