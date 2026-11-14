import type { Request, RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { authOf, ensureRole } from '../../middleware/auth.js';
import { areaQuery, notificationsQuery, type Area } from './notifications.model.js';
import type { NotificationsService } from './notifications.service.js';

function areaOf(req: Request, role: Area['role']): Area {
  ensureRole(req, role);
  return { userId: authOf(req).user.id, role };
}

export function createNotificationsController(service: NotificationsService) {
  return {
    page: (async (req, res) => {
      const { role, ...pagination } = notificationsQuery.parse(req.query);
      res.json(await service.page(areaOf(req, role), pagination));
    }) satisfies RequestHandler,
    unreadCount: (async (req, res) => {
      const area = areaOf(req, areaQuery.parse(req.query).role);
      res.json({ count: await service.unreadCount(area) });
    }) satisfies RequestHandler,
    markRead: (async (req, res) => {
      await service.markRead(authOf(req).user.id, idParams.parse(req.params).id);
      res.status(204).end();
    }) satisfies RequestHandler,
    markAllRead: (async (req, res) => {
      await service.markAllRead(areaOf(req, areaQuery.parse(req.query).role));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}

export type NotificationsController = ReturnType<typeof createNotificationsController>;
