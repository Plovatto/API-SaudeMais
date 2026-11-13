import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '@/lib/graceful-shutdown.js';

function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

function get(port: number) {
  return new Promise<string>((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, path: '/' }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve(body));
    })
      .on('error', reject)
      .end();
  });
}

describe('createShutdown', () => {
  it('finishes in-flight requests, then closes the database pool', async () => {
    const order: string[] = [];
    const { server, port } = await listen((_req, res) => {
      setTimeout(() => {
        order.push('request finished');
        res.end('ok');
      }, 50);
    });
    const pool = { end: vi.fn(() => Promise.resolve(order.push('pool closed')).then(() => undefined)) };
    const shutdown = createShutdown({ server, pool, timeoutMs: 1_000 });

    const inFlight = get(port);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await shutdown();

    await expect(inFlight).resolves.toBe('ok');
    expect(order).toEqual(['request finished', 'pool closed']);
    expect(server.listening).toBe(false);
  });

  it('runs only once when several signals arrive', async () => {
    const { server } = await listen((_req, res) => res.end());
    const pool = { end: vi.fn(() => Promise.resolve()) };
    const shutdown = createShutdown({ server, pool, timeoutMs: 1_000 });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('gives up waiting after the timeout and still closes the pool', async () => {
    const { server, port } = await listen(() => undefined);
    const pool = { end: vi.fn(() => Promise.resolve()) };
    const shutdown = createShutdown({ server, pool, timeoutMs: 100 });

    get(port).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const started = Date.now();
    await shutdown();

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
