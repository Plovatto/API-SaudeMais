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

const COUNTER_TTL = 10 * MINUTE;
const COUNTER_MAX_ENTRIES = 1000;

export interface NotificationsModuleDeps {
  db: Database;
  clock: Clock;
}

export function createNotificationsModule({ db, clock }: NotificationsModuleDeps) {
  const service = new NotificationsService(
    new NotificationsRepository(db),
    new TtlCache<number>(clock, COUNTER_TTL, COUNTER_MAX_ENTRIES),
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
