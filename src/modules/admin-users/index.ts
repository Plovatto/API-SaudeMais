import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { PasswordResetService } from '../password-reset/password-reset.service.js';
import { createAdminUserController } from './admin-users.controller.js';
import { AdminUserRepository } from './admin-users.repository.js';
import { createAdminUserRouter } from './admin-users.routes.js';
import { AdminUserService } from './admin-users.service.js';

export interface AdminUsersModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  passwordReset: PasswordResetService;
}

export function createAdminUsersModule({ db, clock, requireAuth, passwordReset }: AdminUsersModuleDeps) {
  const service = new AdminUserService(new AdminUserRepository(db), passwordReset, clock);
  const router = createAdminUserRouter({
    controller: createAdminUserController(service),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
  });
  return { router, service };
}
