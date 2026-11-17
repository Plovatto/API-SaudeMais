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
