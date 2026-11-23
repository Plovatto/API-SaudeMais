import { logger } from '../../config/logger.js';
import type { EmailTopic } from '../../database/schema/email-preferences.js';
import type { Clock } from '../../lib/clock.js';
import { DAY, MINUTE } from '../../lib/time.js';
import type { MailQueue } from '../../mail/index.js';
import type { Delivery } from '../notifications/notifications.service.js';
import { topicOf } from './email-notifications.model.js';
import type { EmailNotificationsRepository } from './email-notifications.repository.js';
import { noticeEmail, reminderEmail } from './email-notifications.templates.js';

const REMINDER_WINDOW = DAY + 10 * MINUTE;

export class EmailNotifier {
  constructor(
    private readonly repository: EmailNotificationsRepository,
    private readonly mail: MailQueue,
    private readonly clock: Clock,
    private readonly appUrl: string,
  ) {}

  deliver(deliveries: Delivery[]): void {
    this.send(deliveries).catch((err: unknown) => logger.error({ err }, 'Notification e-mails failed'));
  }

  async remindUpcoming(): Promise<number> {
    const now = this.clock.now();
    const reminders = await this.repository.claimReminders(now, new Date(now.getTime() + REMINDER_WINDOW));
    const dropped = reminders.filter((reminder) => !this.mail.enqueue(reminderEmail(reminder, this.appUrl)));
    if (dropped.length > 0) await this.repository.releaseReminders(dropped.map(({ bookingId }) => bookingId), now);
    return reminders.length - dropped.length;
  }

  private async send(deliveries: Delivery[]): Promise<void> {
    const byTopic = new Map<EmailTopic, Delivery[]>();
    for (const delivery of deliveries) {
      const topic = topicOf(delivery.type, delivery.audienceRole);
      if (topic) byTopic.set(topic, [...(byTopic.get(topic) ?? []), delivery]);
    }
    for (const [topic, group] of byTopic) {
      const recipients = await this.repository.recipients(
        group.map((delivery) => delivery.userId),
        topic,
      );
      const byUser = new Map(recipients.map((recipient) => [recipient.userId, recipient]));
      for (const { type, params, bookingId, audienceRole, userId } of group) {
        const recipient = byUser.get(userId);
        if (recipient) {
          this.mail.enqueue(noticeEmail(type, params ?? {}, bookingId ?? null, audienceRole, recipient, this.appUrl));
        }
      }
    }
  }
}
