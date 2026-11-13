import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp, TEST_CORS_ORIGIN } from './support/build-test-app.js';

describe('security headers', () => {
  it('sends helmet headers and hides the framework', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows only the configured front origin, without credentials', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health').set('Origin', TEST_CORS_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(TEST_CORS_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('never reflects or wildcards another origin', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBe(TEST_CORS_ORIGIN);
    expect(response.headers.vary).toContain('Origin');
  });

  it('answers the preflight sent before calls with a Bearer token', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .options('/api/anything')
      .set('Origin', TEST_CORS_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(TEST_CORS_ORIGIN);
    expect(response.headers['access-control-allow-headers']).toBe('authorization,content-type');
    expect(response.headers['access-control-max-age']).toBe('600');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('unknown routes and bad bodies', () => {
  it('returns 404 as json with a stable code, without echoing the path or query string', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/api/does-not-exist?token=secret');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: 'Rota não encontrada.', code: 'ROUTE_NOT_FOUND' });
  });

  it('answers invalid json with 400', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' });
  });

  it('rejects bodies larger than 100 kb with 413', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ data: 'x'.repeat(110 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ message: 'O corpo da requisição é grande demais.', code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers a malformed compressed body with 400 instead of 500', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'br')
      .send('{}');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Requisição inválida.', code: 'BAD_REQUEST' });
  });
});

describe('access log', () => {
  it('logs method, path and status without query string or headers', async () => {
    const { app, logLines } = buildTestApp();

    await request(app)
      .get('/api/x/PATHVALUE?token=QUERYSECRET&email=ana@example.com')
      .set('Authorization', 'Bearer HEADERSECRET')
      .set('Cookie', 'sid=COOKIESECRET');

    const output = logLines.join('');
    expect(logLines).toHaveLength(1);
    const entry = JSON.parse(logLines[0] ?? '{}') as {
      level: number;
      req: Record<string, unknown>;
      res: Record<string, unknown>;
    };
    expect(entry.level).toBe(40);
    expect(entry.req).toEqual({
      id: expect.anything() as unknown,
      method: 'GET',
      path: '/api/x/PATHVALUE',
      ip: expect.any(String) as unknown,
    });
    expect(entry.res).toEqual({ statusCode: 404 });
    for (const secret of ['QUERYSECRET', 'ana@example.com', 'HEADERSECRET', 'COOKIESECRET']) {
      expect(output).not.toContain(secret);
    }
  });

  it('logs requests that fail in the body parser and CORS preflights', async () => {
    const { app, logLines } = buildTestApp();

    await request(app).post('/api/anything').set('Content-Type', 'application/json').send('{"broken":');
    await request(app)
      .options('/api/anything')
      .set('Origin', TEST_CORS_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    const statuses = logLines.map((line) => (JSON.parse(line) as { res: { statusCode: number } }).res.statusCode);
    expect(statuses).toEqual([400, 204]);
  });
});

describe('trust proxy', () => {
  it('logs the client IP from X-Forwarded-For only when a proxy hop is trusted', async () => {
    const direct = buildTestApp();
    const proxied = buildTestApp({ TRUST_PROXY_HOPS: 1 });

    await request(direct.app).get('/api/x').set('X-Forwarded-For', '203.0.113.7');
    await request(proxied.app).get('/api/x').set('X-Forwarded-For', '203.0.113.7');

    const ipOf = (lines: string[]) => (JSON.parse(lines[0] ?? '{}') as { req: { ip: string } }).req.ip;
    expect(ipOf(direct.logLines)).not.toBe('203.0.113.7');
    expect(ipOf(proxied.logLines)).toBe('203.0.113.7');
  });
});
