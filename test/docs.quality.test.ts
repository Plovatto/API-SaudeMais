import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './support/build-test-app.js';

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  requestBody?: unknown;
  parameters?: unknown[];
  responses: Record<string, unknown>;
}

interface Document {
  info: { description?: string; contact?: unknown };
  servers: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  externalDocs?: { url: string };
  security?: Record<string, string[]>[];
  paths: Record<string, Record<string, Operation>>;
}

const httpMethods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

async function loadDocument() {
  const { app } = buildTestApp();
  const response = await request(app).get('/docs/openapi.json');
  const document = response.body as Document;
  const operations = Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => httpMethods.has(method))
      .map(([method, operation]) => ({ name: `${method.toUpperCase()} ${path}`, operation })),
  );
  return { document, operations };
}

describe('API documentation quality', () => {
  it('explains the conventions shared by every route', async () => {
    const { document } = await loadDocument();

    for (const section of ['Erros', 'Códigos de erro', 'Autenticação', 'Datas', 'Paginação']) {
      expect(document.info.description).toContain(`## ${section}`);
    }
    expect(document.info.contact).toBeDefined();
    expect(document.externalDocs?.url).toBe('https://github.com/Plovatto/API-SaudeMais');
  });

  it('points requests made from the page at the server that serves it', async () => {
    const { document } = await loadDocument();

    expect(document.servers).toEqual([{ url: '/', description: 'Servidor desta página' }]);
  });

  it('describes every tag and uses only declared tags', async () => {
    const { document, operations } = await loadDocument();
    const declared = new Map((document.tags ?? []).map((tag) => [tag.name, tag.description]));

    expect(declared.size).toBeGreaterThan(0);
    expect([...declared.values()].every(Boolean)).toBe(true);
    for (const { name, operation } of operations) {
      expect(operation.tags, name).toHaveLength(1);
      expect(declared.has(operation.tags?.[0] ?? ''), name).toBe(true);
    }
  });

  it('gives every operation a summary, a description and a unique operationId', async () => {
    const { operations } = await loadDocument();
    const ids = operations.map(({ operation }) => operation.operationId);

    for (const { name, operation } of operations) {
      expect(operation.summary, name).toBeTruthy();
      expect(operation.description, name).toBeTruthy();
      expect(operation.operationId, name).toMatch(/^[a-z][A-Za-z]+$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents the error responses each operation can return', async () => {
    const { document, operations } = await loadDocument();

    for (const { name, operation } of operations) {
      const statuses = Object.keys(operation.responses);
      const security = operation.security ?? document.security ?? [];
      expect(statuses, name).toContain('500');
      if (operation.requestBody || operation.parameters?.length) expect(statuses, name).toContain('400');
      if (security.some((requirement) => Object.keys(requirement as object).length > 0)) {
        expect(statuses, name).toContain('401');
      }
    }
  });
});

describe('Swagger UI presentation', () => {
  it('uses the Saúde+ title, styles and navigation options', async () => {
    const { app } = buildTestApp();

    const page = await request(app).get('/docs/');
    const init = await request(app).get('/docs/swagger-ui-init.js');

    expect(page.text).toContain('<title>Saúde+ API</title>');
    expect(page.text).toContain('.swagger-ui .topbar');
    expect(init.text).toContain('"filter": true');
    expect(init.text).toContain('"displayRequestDuration": true');
    expect(init.text).toContain('"persistAuthorization": true');
  });

  it('does not keep the session token in the browser in production', async () => {
    const { app } = buildTestApp({ NODE_ENV: 'production' });

    await request(app).get('/docs/');
    const init = await request(app).get('/docs/swagger-ui-init.js');

    expect(init.text).toContain('"persistAuthorization": false');
  });
});
