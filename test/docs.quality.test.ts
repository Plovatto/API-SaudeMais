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
  responses: Record<string, unknown>;
}

interface Document {
  info: { description?: string; contact?: unknown };
  servers: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  externalDocs?: { url: string };
  paths: Record<string, Record<string, Operation>>;
}

const httpMethods = new Set(['get', 'put', 'post', 'delete', 'patch']);

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

    for (const section of ['Autenticação', 'Erros', 'Códigos de erro', 'Datas', 'Paginação']) {
      expect(document.info.description).toContain(`## ${section}`);
    }
    expect(document.info.contact).toBeDefined();
    expect(document.externalDocs?.url).toBe('https://github.com/Plovatto/API-SaudeMais');
  });

  it('lists the current, production and local servers', async () => {
    const { document } = await loadDocument();

    expect(document.servers.map((server) => server.url)).toEqual([
      '/',
      'https://p01--saudemais--pgj2h2jjxzb4.code.run',
      'http://localhost:3001',
    ]);
    expect(document.servers.every((server) => server.description)).toBe(true);
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
    const { operations } = await loadDocument();

    for (const { name, operation } of operations) {
      expect(Object.keys(operation.responses), name).toContain('500');
      if (operation.requestBody) expect(Object.keys(operation.responses), name).toContain('400');
      if (operation.security?.length) expect(Object.keys(operation.responses), name).toContain('401');
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
});
