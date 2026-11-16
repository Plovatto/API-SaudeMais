import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import { AdminReportsRepository } from './admin-reports.repository.js';
import { createAdminReportsRouter } from './admin-reports.routes.js';
import { AdminReportsService } from './admin-reports.service.js';

export interface AdminReportsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
}

export function createAdminReportsModule({ db, clock, requireAuth }: AdminReportsModuleDeps) {
  const service = new AdminReportsService(new AdminReportsRepository(db), clock);
  const router = createAdminReportsRouter({ service, requireAuth, requireAdmin: createRequireRole('admin') });
  return { router };
}
