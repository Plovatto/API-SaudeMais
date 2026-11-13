import SwaggerParser from '@apidevtools/swagger-parser';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { listRoutes } from './support/list-routes.js';
import { buildTestApp } from './support/build-test-app.js';

interface OpenApiDocument {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
}

async function fetchDocument() {
  const { app } = buildTestApp();
  const response = await request(app).get('/docs/openapi.json');
  return { app, response, document: response.body as OpenApiDocument };
}

describe('GET /docs/openapi.json', () => {
  it('serves a valid OpenAPI 3.1 document', async () => {
    const { response, document } = await fetchDocument();

    expect(response.status).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('Saúde+ API');
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();
  });

  it('describes the error body and the bearer session', async () => {
    const { document } = await fetchDocument();

    expect(document.components.schemas.ErrorResponse).toMatchObject({
      type: 'object',
      properties: {
        message: expect.objectContaining({ type: 'string' }) as unknown,
        code: expect.objectContaining({ type: 'string' }) as unknown,
        fields: expect.objectContaining({ type: 'object' }) as unknown,
      },
      required: ['message', 'code'],
    });
    expect(document.components.securitySchemes.sessionAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('documents every route the app serves', async () => {
    const { app, document } = await fetchDocument();

    const httpMethods = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method) => httpMethods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    const docsRoutes = new Set(['GET /docs/', 'GET /docs/openapi.json']);
    const served = listRoutes(app).filter((route) => !docsRoutes.has(route));

    expect(served.length).toBeGreaterThan(0);
    expect(documented.sort()).toEqual(served.sort());
  });
});

describe('GET /docs', () => {
  it('serves Swagger UI without inline scripts, so the strict CSP stays on', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/docs/');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('swagger-ui-init.js');
    expect(response.text).not.toMatch(/<script>(?!\s*<\/script>)/);
    const directives = String(response.headers['content-security-policy']).split(';');
    expect(directives).toContain("script-src 'self'");
  });

  it('points Swagger UI at the served document', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/docs/swagger-ui-init.js');

    expect(response.status).toBe(200);
    expect(response.text).toContain('"title": "Saúde+ API"');
  });

  it('does not force https outside production, so the page works over plain http', async () => {
    const development = buildTestApp({ NODE_ENV: 'development' });
    const production = buildTestApp({ NODE_ENV: 'production' });

    const devResponse = await request(development.app).get('/docs/');
    const prodResponse = await request(production.app).get('/docs/');

    expect(devResponse.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    expect(prodResponse.headers['content-security-policy']).toContain('upgrade-insecure-requests');
  });

  it('answers unknown docs paths and other methods with the json 404', async () => {
    const { app } = buildTestApp();

    const unknown = await request(app).get('/docs/nope');
    const post = await request(app).post('/docs/');

    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ message: 'Rota não encontrada.', code: 'ROUTE_NOT_FOUND' });
    expect(post.status).toBe(404);
  });

  it('keeps docs page loads out of the access log but logs the document', async () => {
    const { app, logLines } = buildTestApp();

    await request(app).get('/docs/');
    await request(app).get('/docs/swagger-ui-init.js');
    await request(app).get('/docs/openapi.json');

    const paths = logLines.map((line) => (JSON.parse(line) as { req: { path: string } }).req.path);
    expect(paths).toEqual(['/docs/openapi.json']);
  });
});
