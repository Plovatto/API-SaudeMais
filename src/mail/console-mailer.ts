import type { Logger } from 'pino';
import type { MailMessage, Mailer } from './mailer.js';

export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  send({ to, subject, text }: MailMessage): Promise<void> {
    this.logger.info({ mail: { to, subject, text } }, 'E-mail written to the log (console driver)');
    return Promise.resolve();
  }
}
