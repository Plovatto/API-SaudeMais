import type { Logger } from 'pino';
import type { MailMessage, Mailer } from './mailer.js';

function failureDetails(error: unknown) {
  const { code, responseCode, command } = (error ?? {}) as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  return { code, responseCode, command };
}

export class MailQueue {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly mailer: Mailer,
    private readonly logger: Logger,
  ) {}

  enqueue(message: MailMessage): void {
    const delivery = Promise.resolve()
      .then(() => this.mailer.send(message))
      .catch((error: unknown) => {
        this.logger.error({ mail: { subject: message.subject, ...failureDetails(error) } }, 'E-mail delivery failed');
      })
      .finally(() => this.pending.delete(delivery));
    this.pending.add(delivery);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}
