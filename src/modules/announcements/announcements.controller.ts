import type { RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { actorOf, ensureRole } from '../../middleware/auth.js';
import {
  announcementsQuery,
  createAnnouncementSchema,
  updateAnnouncementSchema,
  visibleQuery,
} from './announcements.model.js';
import type { AnnouncementsService } from './announcements.service.js';

export function createAnnouncementsController(service: AnnouncementsService) {
  return {
    page: (async (req, res) => {
      res.json(await service.page(announcementsQuery.parse(req.query)));
    }) satisfies RequestHandler,
    create: (async (req, res) => {
      res.status(201).json(await service.create(actorOf(req), createAnnouncementSchema.parse(req.body)));
    }) satisfies RequestHandler,
    update: (async (req, res) => {
      const { id } = idParams.parse(req.params);
      res.json(await service.update(actorOf(req), id, updateAnnouncementSchema.parse(req.body)));
    }) satisfies RequestHandler,
    remove: (async (req, res) => {
      await service.remove(actorOf(req), idParams.parse(req.params).id);
      res.status(204).end();
    }) satisfies RequestHandler,
    visible: (async (req, res) => {
      const { role } = visibleQuery.parse(req.query);
      ensureRole(req, role);
      res.json(await service.visible(role));
    }) satisfies RequestHandler,
  };
}

export type AnnouncementsController = ReturnType<typeof createAnnouncementsController>;
