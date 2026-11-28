import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { createRequireRole } from '../../middleware/auth.js';
import { createAnnouncementsController } from './announcements.controller.js';
import { AnnouncementsRepository } from './announcements.repository.js';
import { createAnnouncementsRouter } from './announcements.routes.js';
import { AnnouncementsService } from './announcements.service.js';

interface AnnouncementsModuleDeps {
  db: Database;
  clock: Clock;
  requireAuth: RequestHandler;
}

export function createAnnouncementsModule({ db, clock, requireAuth }: AnnouncementsModuleDeps) {
  const service = new AnnouncementsService(new AnnouncementsRepository(db), clock);
  const router = createAnnouncementsRouter({
    controller: createAnnouncementsController(service),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
  });
  return { router, service };
}
