import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './support/build-test-app.js';

describe('GET /health', () => {
  it('reports the server as healthy with its uptime', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect((response.body as { uptime: number }).uptime).toBeGreaterThanOrEqual(0);
  });

  it('sends security headers and hides the framework', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows the configured front origin without credentials', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health').set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not allow other origins', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health').set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('unknown routes', () => {
  it('returns 404 as json with a stable code', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/api/does-not-exist?token=secret');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      message: 'Rota não encontrada: GET /api/does-not-exist',
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('answers invalid json with 400 instead of 500', async () => {
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
    expect(response.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});
