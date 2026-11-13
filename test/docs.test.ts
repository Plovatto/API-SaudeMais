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

    expect(document.components.schemas.ErrorResponse).toEqual({
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

    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const served = listRoutes(app).filter((route) => !route.startsWith('GET /docs'));

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
});
