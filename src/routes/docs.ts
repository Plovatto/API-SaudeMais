import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import '../docs/common-schemas.js';
import { generateOpenApiDocument } from '../docs/openapi-document.js';
import { swaggerTheme } from '../docs/swagger-theme.js';

export function createDocsRouter({ persistAuthorization }: { persistAuthorization: boolean }): Router {
  const document = generateOpenApiDocument();
  const router = Router();
  router.get('/docs/openapi.json', (_req, res) => {
    res.json(document);
  });
  router.use('/docs', swaggerUi.serve);
  router.get(
    '/docs/',
    swaggerUi.setup(document, {
      customSiteTitle: 'Saúde+ API',
      customCss: swaggerTheme,
      swaggerOptions: {
        docExpansion: 'list',
        filter: true,
        displayRequestDuration: true,
        persistAuthorization,
        defaultModelsExpandDepth: 0,
      },
    }),
  );
  return router;
}
