import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireAuth } from '../../middleware/auth.js';
import { createUserController } from './user.controller.js';
import { DEMO_ACCOUNTS } from './user.demo.js';
import { UserRepository } from './user.repository.js';
import { placeholderPasswordHash } from './user.password.js';
import { createUserRouter } from './user.routes.js';
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
}

export function createUsersModule({ db, clock, policy }: UsersModuleDeps) {
  placeholderPasswordHash().catch(() => undefined);
  const service = new UserService(new UserRepository(db), clock, policy);
  const requireAuth = createRequireAuth(service);
  const router = createUserRouter({
    controller: createUserController(service),
    requireAuth,
  });
  const bootstrap = async (admin: InitialAdmin | undefined) => {
    if (admin) {
      await service.ensureAccount({
        fullName: 'Administrador',
        ...admin,
        roles: ['patient', 'admin'],
        isProtected: false,
      });
    }
    for (const account of DEMO_ACCOUNTS) await service.ensureAccount(account);
  };
  return { router, requireAuth, service, bootstrap };
}
