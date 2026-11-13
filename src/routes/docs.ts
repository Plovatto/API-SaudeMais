import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import '../docs/common-schemas.js';
import { generateOpenApiDocument } from '../docs/openapi-document.js';

export function createDocsRouter(): Router {
  const document = generateOpenApiDocument();
  const router = Router();
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'Saúde+ API' }));
  return router;
}
