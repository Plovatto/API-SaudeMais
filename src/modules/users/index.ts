import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireAuth } from '../../middleware/auth.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { createUserController } from './user.controller.js';
import { UserRepository } from './user.repository.js';
import { placeholderPasswordHash } from './user.password.js';
import { createUserRouter } from './user.routes.js';
import type { SessionCache } from './user.session-cache.js';
import { UserService, type SessionPolicy } from './user.service.js';

export type { AuthContext, SessionPolicy } from './user.service.js';

export interface InitialAdmin {
  email: string;
  password: string;
}

export interface UsersModuleDeps {
  db: Database;
  clock: Clock;
  policy: SessionPolicy;
  notifications: NotificationsService;
  sessions: SessionCache;
}

export function createUsersModule({ db, clock, policy, notifications, sessions }: UsersModuleDeps) {
  placeholderPasswordHash().catch(() => undefined);
  const service = new UserService(new UserRepository(db), clock, policy, notifications, sessions);
  const requireAuth = createRequireAuth(service);
  const router = createUserRouter({ controller: createUserController(service), requireAuth });
  const bootstrap = async (admin: InitialAdmin): Promise<void> => {
    await service.ensureAccount({ fullName: 'Administrador', ...admin, roles: ['patient', 'admin'] });
  };
  return { router, requireAuth, service, bootstrap };
}
