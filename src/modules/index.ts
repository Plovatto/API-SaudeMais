import type { Database } from '../database/pg-client.js';
import type { Clock } from '../lib/clock.js';
import type { MailQueue } from '../mail/index.js';
import { createPasswordResetModule } from './password-reset/index.js';
import { createUsersModule, type SessionPolicy } from './users/index.js';

export interface ModulesDeps {
  db: Database;
  clock: Clock;
  policy: SessionPolicy;
  mail: MailQueue;
  appUrl: string;
}

export function createModules(deps: ModulesDeps) {
  const users = createUsersModule(deps);
  const passwordReset = createPasswordResetModule(deps);
  return { users, passwordReset, routers: [users.router, passwordReset.router] };
}
