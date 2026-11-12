import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './support/build-test-app.js';

describe('GET /health', () => {
  it('reports the server as healthy and nothing else', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('is not written to the access log, even with a query string', async () => {
    const { app, logLines } = buildTestApp();

    await request(app).get('/health');
    await request(app).get('/health?probe=1');

    expect(logLines).toEqual([]);
  });
});
