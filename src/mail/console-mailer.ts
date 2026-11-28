import type { Logger } from 'pino';
import type { MailMessage, Mailer } from './mailer.js';

export class ConsoleMailer implements Mailer {
  constructor(
    private readonly logger: Logger,
    private readonly verbose = false,
  ) {}

  send({ to, subject, text }: MailMessage): Promise<void> {
    const mail = this.verbose ? { to, subject, text } : { subject };
    this.logger.info({ mail }, 'E-mail written to the log (console driver)');
    return Promise.resolve();
  }
}
