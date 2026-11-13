import type { RequestHandler } from 'express';
import type { Database } from '../../database/pg-client.js';
import { createRequireRole } from '../../middleware/auth.js';
import { createCatalogController } from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';
import { createCatalogRouter } from './catalog.routes.js';
import { CatalogService } from './catalog.service.js';

export interface CatalogModuleDeps {
  db: Database;
  requireAuth: RequestHandler;
}

export function createCatalogModule({ db, requireAuth }: CatalogModuleDeps) {
  const service = new CatalogService(new CatalogRepository(db));
  const router = createCatalogRouter({
    controller: createCatalogController(service),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
  });
  return { router, service };
}
