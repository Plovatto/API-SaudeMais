import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { MINUTE } from '../../lib/time.js';
import type { MailQueue } from '../../mail/index.js';
import { UserRepository } from '../users/user.repository.js';
import { PasswordResetRepository } from './password-reset.repository.js';
import { createPasswordResetRouter } from './password-reset.routes.js';
import { PasswordResetService } from './password-reset.service.js';

export interface PasswordResetModuleDeps {
  db: Database;
  clock: Clock;
  mail: MailQueue;
  appUrl: string;
}

export function createPasswordResetModule({ db, clock, mail, appUrl }: PasswordResetModuleDeps) {
  const resets = new PasswordResetRepository(db, { perUserPerDay: 3, globalPerDay: 100, minIntervalMs: 15 * MINUTE });
  const service = new PasswordResetService(resets, new UserRepository(db), mail, clock, appUrl);
  return { router: createPasswordResetRouter(service), service };
}
