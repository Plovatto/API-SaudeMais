import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireAuth } from '../../middleware/auth.js';
import { createUserController } from './user.controller.js';
import { UserRepository } from './user.repository.js';
import { placeholderPasswordHash } from './user.password.js';
import { createUserRouter } from './user.routes.js';
import { UserService, type SessionPolicy } from './user.service.js';

export type { AuthContext, SessionPolicy } from './user.service.js';

export interface UsersModuleDeps {
  db: Database;
  clock: Clock;
  policy: SessionPolicy;
}

export function createUsersModule({ db, clock, policy }: UsersModuleDeps) {
  placeholderPasswordHash().catch(() => undefined);
  const service = new UserService(new UserRepository(db), clock, policy);
  const requireAuth = createRequireAuth(service);
  const router = createUserRouter({
    controller: createUserController(service),
    requireAuth,
  });
  return { router, requireAuth, service };
}
