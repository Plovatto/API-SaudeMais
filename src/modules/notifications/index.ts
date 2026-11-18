import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import { MINUTE } from '../../lib/time.js';
import { TtlCache } from '../../lib/ttl-cache.js';
import { createNotificationsController } from './notifications.controller.js';
import { NotificationsRepository } from './notifications.repository.js';
import { createNotificationsRouter } from './notifications.routes.js';
import { NotificationsService, type Delivery } from './notifications.service.js';

const COUNTER_TTL = 10 * MINUTE;
const COUNTER_MAX_ENTRIES = 1000;

interface NotificationsModuleDeps {
  db: Database;
  clock: Clock;
  onDelivered?: (deliveries: Delivery[]) => void;
}

export function createNotificationsModule({ db, clock, onDelivered }: NotificationsModuleDeps) {
  const service = new NotificationsService(
    new NotificationsRepository(db),
    new TtlCache<number>(clock, COUNTER_TTL, COUNTER_MAX_ENTRIES),
    clock,
    onDelivered,
  );
  const routerFor = (requireAuth: RequestHandler) =>
    createNotificationsRouter({ controller: createNotificationsController(service), requireAuth });
  return { service, routerFor };
}
