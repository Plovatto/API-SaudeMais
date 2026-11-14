import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import { AdminHomeRepository } from './admin-home.repository.js';
import { createAdminHomeRouter } from './admin-home.routes.js';
import { AdminHomeService } from './admin-home.service.js';

export interface AdminHomeModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
}

export function createAdminHomeModule({ db, clock, requireAuth }: AdminHomeModuleDeps) {
  const service = new AdminHomeService(new AdminHomeRepository(db), clock);
  const router = createAdminHomeRouter({ service, requireAuth, requireAdmin: createRequireRole('admin') });
  return { router, service };
}
