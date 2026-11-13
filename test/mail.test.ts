import { Writable } from 'node:stream';
import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/config/logger.js';
import { ConsoleMailer } from '@/mail/console-mailer.js';
import { createMailer, MailQueue, type MailMessage } from '@/mail/index.js';
import { SmtpMailer } from '@/mail/smtp-mailer.js';
import { MemoryMailer } from './support/memory-mailer.js';

const message: MailMessage = {
  to: 'ana.silva@email.com',
  subject: 'Redefinição de senha',
  html: '<p>Use o link para redefinir a senha.</p>',
  text: 'Use o link para redefinir a senha.',
};

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'info' }, destination), lines };
}

describe('MailQueue', () => {
  it('sends outside the request and lets callers wait for delivery', async () => {
    const { logger } = captureLogger();
    const mailer = new MemoryMailer();
    const queue = new MailQueue(mailer, logger);

    queue.enqueue(message);
    expect(mailer.sent).toHaveLength(0);
    await queue.drain();

    expect(mailer.sent).toEqual([message]);
  });

  it('logs a failed delivery without throwing or exposing the recipient', async () => {
    const { logger, lines } = captureLogger();
    const failing = {
      send: () =>
        Promise.reject(Object.assign(new Error('Invalid login: 535 secret'), { code: 'EAUTH', responseCode: 535 })),
    };
    const queue = new MailQueue(failing, logger);

    expect(() => queue.enqueue(message)).not.toThrow();
    await queue.drain();

    const output = lines.join('');
    expect(output).toContain('E-mail delivery failed');
    expect(output).toContain('EAUTH');
    expect(output).not.toContain(message.to);
    expect(output).not.toContain('secret');
  });
});

describe('mail queue limits', () => {
  it('drops messages once too many are waiting instead of growing without bound', async () => {
    const { logger, lines } = captureLogger();
    let release: () => void = () => undefined;
    const stuck = { send: () => new Promise<void>((resolve) => (release = resolve)) };
    const queue = new MailQueue(stuck, logger);

    for (let index = 0; index < 201; index += 1) queue.enqueue(message);

    expect(lines.join('')).toContain('E-mail queue full');
    release();
  });
});

describe('createMailer', () => {
  it('refuses the smtp driver without credentials instead of falling back to the log', () => {
    const { logger } = captureLogger();

    expect(() => createMailer({ MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 465 }, logger)).toThrow(
      /required for smtp/,
    );
  });
});

describe('mail drivers', () => {
  it('sends through SMTP with the configured sender', async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const sendMail = vi.spyOn(transporter, 'sendMail');

    await new SmtpMailer(transporter, 'Saúde+ <saudemais.app@gmail.com>').send(message);

    expect(sendMail).toHaveBeenCalledWith({ from: 'Saúde+ <saudemais.app@gmail.com>', ...message });
  });

  it('writes the message to the log in development', async () => {
    const { logger, lines } = captureLogger();

    await new ConsoleMailer(logger).send(message);

    expect(lines.join('')).toContain(message.subject);
  });

  it('keeps SMTP passwords out of the logs', () => {
    const { logger, lines } = captureLogger();

    logger.info({ auth: { user: 'saudemais.app@gmail.com', pass: 'APPPASSWORD' }, SMTP_PASS: 'APPPASSWORD' });

    expect(lines.join('')).not.toContain('APPPASSWORD');
  });
});
