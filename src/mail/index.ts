import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { ConsoleMailer } from './console-mailer.js';
import type { Mailer } from './mailer.js';
import { createSmtpTransport, SmtpMailer } from './smtp-mailer.js';

export type { MailMessage, Mailer } from './mailer.js';
export { MailQueue } from './mail-queue.js';

type MailConfig = Pick<Env, 'MAIL_DRIVER' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM'>;

export async function createMailer(config: MailConfig, logger: Logger): Promise<Mailer> {
  const { MAIL_DRIVER, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = config;
  if (MAIL_DRIVER === 'console' || !SMTP_USER || !SMTP_PASS || !MAIL_FROM) return new ConsoleMailer(logger);
  const transporter = createSmtpTransport({ host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS });
  try {
    await transporter.verify();
    logger.info('SMTP server reachable');
  } catch (error) {
    const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
    logger.warn({ mail: { code, responseCode } }, 'SMTP server not reachable; e-mails will be retried per send');
  }
  return new SmtpMailer(transporter, MAIL_FROM);
}
