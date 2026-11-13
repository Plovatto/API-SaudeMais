import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import { ConsoleMailer } from './console-mailer.js';
import { deliveryFailure } from './mail-queue.js';
import type { Mailer } from './mailer.js';
import { createSmtpTransport, SmtpMailer } from './smtp-mailer.js';

export type { MailMessage, Mailer } from './mailer.js';
export { MailQueue } from './mail-queue.js';

type MailConfig = Pick<Env, 'MAIL_DRIVER' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM'>;

export function createMailer(config: MailConfig, logger: Logger): Mailer {
  const { MAIL_DRIVER, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = config;
  if (MAIL_DRIVER === 'console') return new ConsoleMailer(logger);
  if (!SMTP_USER || !SMTP_PASS || !MAIL_FROM)
    throw new Error('SMTP_USER, SMTP_PASS and MAIL_FROM are required for smtp');
  const transporter = createSmtpTransport({ host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS });
  transporter.verify().then(
    () => logger.info('SMTP server reachable'),
    (error: unknown) => logger.warn({ mail: deliveryFailure(error) }, 'SMTP server not reachable'),
  );
  return new SmtpMailer(transporter, MAIL_FROM);
}
