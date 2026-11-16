import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireApiKey } from '../../middleware/api-key.js';
import { createRequireRole } from '../../middleware/auth.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { createLabIntegrationController } from './lab-integration.controller.js';
import { LabIntegrationRepository } from './lab-integration.repository.js';
import { createLabIntegrationRouter } from './lab-integration.routes.js';
import { LabIntegrationService } from './lab-integration.service.js';

export interface LabIntegrationModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
  notifications: NotificationsService;
}

export function createLabIntegrationModule({ db, clock, requireAuth, notifications }: LabIntegrationModuleDeps) {
  const service = new LabIntegrationService(new LabIntegrationRepository(db), notifications, clock);
  const router = createLabIntegrationRouter({
    controller: createLabIntegrationController(service),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
    requireApiKey: createRequireApiKey((apiKey) => service.authenticate(apiKey)),
  });
  return { router, service };
}
