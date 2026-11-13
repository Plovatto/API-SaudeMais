import type { Database } from '../database/pg-client.js';
import type { Clock } from '../lib/clock.js';
import { createUsersModule, type SessionPolicy } from './users/index.js';

export interface ModulesDeps {
  db: Database;
  clock: Clock;
  policy: SessionPolicy;
}

export function createModules(deps: ModulesDeps) {
  const users = createUsersModule(deps);
  return { users, routers: [users.router] };
}
