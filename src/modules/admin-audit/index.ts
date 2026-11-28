import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import { createRequireRole } from '../../middleware/auth.js';
import { AdminAuditRepository } from './admin-audit.repository.js';
import { createAdminAuditRouter } from './admin-audit.routes.js';
import { AdminAuditService } from './admin-audit.service.js';

interface AdminAuditModuleDeps {
  db: Database;
  requireAuth: RequestHandler;
}

export function createAdminAuditModule({ db, requireAuth }: AdminAuditModuleDeps) {
  const service = new AdminAuditService(new AdminAuditRepository(db));
  const router = createAdminAuditRouter({ service, requireAuth, requireAdmin: createRequireRole('admin') });
  return { router, service };
}
