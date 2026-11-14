import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { MINUTE } from '../../lib/time.js';
import { TtlCache } from '../../lib/ttl-cache.js';
import { createRequireWritable } from '../../middleware/auth.js';
import { createNotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { createNotificationsRouter } from './notifications.routes.js';
import { NotificationsService } from './notifications.service.js';

export interface NotificationsModuleDeps {
  db: Database;
  clock: Clock;
}

export function createNotificationsModule({ db, clock }: NotificationsModuleDeps) {
  const service = new NotificationsService(
    new NotificationsRepository(db),
    new TtlCache<number>(clock, 10 * MINUTE, 1000),
    clock,
  );
  const routerFor = (requireAuth: RequestHandler) =>
    createNotificationsRouter({
      controller: createNotificationsController(service),
      requireAuth,
      requireWritable: createRequireWritable(),
    });
  return { service, routerFor };
}
