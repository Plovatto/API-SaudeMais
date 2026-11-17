import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import type { MailQueue } from '../../mail/index.js';
import { createRequireWritable } from '../../middleware/auth.js';
import { EmailNotifier } from './email-notifications.notifier.js';
import { EmailNotificationsRepository } from './email-notifications.repository.js';
import { createEmailNotificationsRouter } from './email-notifications.routes.js';
import { EmailNotificationsService } from './email-notifications.service.js';

export interface EmailNotificationsModuleDeps {
  db: Database;
  clock: Clock;
  mail: MailQueue;
  appUrl: string;
}

export function createEmailNotificationsModule({ db, clock, mail, appUrl }: EmailNotificationsModuleDeps) {
  const repository = new EmailNotificationsRepository(db);
  const notifier = new EmailNotifier(repository, mail, clock, appUrl);
  const service = new EmailNotificationsService(repository, clock);
  const routerFor = (requireAuth: RequestHandler) =>
    createEmailNotificationsRouter({ service, requireAuth, requireWritable: createRequireWritable() });
  return { notifier, routerFor };
}
