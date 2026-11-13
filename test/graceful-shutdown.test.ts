import { Agent, createServer, request as httpRequest, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '@/lib/graceful-shutdown.js';

function listen(handler: RequestListener) {
  const server = createServer(handler);
  return new Promise<{ server: typeof server; port: number }>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

function get(port: number, agent?: Agent) {
  return new Promise<{ body: string; connection: string | undefined }>((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve({ body, connection: res.headers.connection }));
    })
      .on('error', reject)
      .end();
  });
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('createShutdown', () => {
  it('finishes in-flight requests, then closes the database pool', async () => {
    const order: string[] = [];
    const arrived = deferred();
    const { server, port } = await listen((_req, res) => {
      arrived.resolve();
      setTimeout(() => {
        order.push('request finished');
        res.end('ok');
      }, 50);
    });
    const pool = { end: vi.fn(() => Promise.resolve(order.push('pool closed')).then(() => undefined)) };
    const shutdown = createShutdown({ pool, timeoutMs: 1_000 });
    shutdown.attach(server);

    const inFlight = get(port);
    await arrived.promise;
    await shutdown.run();

    await expect(inFlight).resolves.toMatchObject({ body: 'ok' });
    expect(order).toEqual(['request finished', 'pool closed']);
    expect(server.listening).toBe(false);
  });

  it('drains keep-alive connections without waiting for the timeout', async () => {
    const { server, port } = await listen((_req, res) => res.end('ok'));
    const agent = new Agent({ keepAlive: true });
    await get(port, agent);
    const shutdown = createShutdown({ pool: { end: () => Promise.resolve() }, timeoutMs: 5_000 });
    shutdown.attach(server);

    const started = Date.now();
    await shutdown.run();

    expect(Date.now() - started).toBeLessThan(1_000);
    agent.destroy();
  });

  it('cuts connections still open after the timeout and still closes the pool', async () => {
    const arrived = deferred();
    const { server, port } = await listen(() => arrived.resolve());
    const pool = { end: vi.fn(() => Promise.resolve()) };
    const shutdown = createShutdown({ pool, timeoutMs: 100 });
    shutdown.attach(server);

    const stuck = get(port);
    await arrived.promise;
    await shutdown.run();

    await expect(stuck).rejects.toThrow();
    expect(server.listening).toBe(false);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('runs only once when several signals arrive', async () => {
    const { server } = await listen((_req, res) => res.end());
    const pool = { end: vi.fn(() => Promise.resolve()) };
    const shutdown = createShutdown({ pool, timeoutMs: 1_000 });
    shutdown.attach(server);

    await Promise.all([shutdown.run(), shutdown.run(), shutdown.run()]);

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('closes the pool when the signal arrives before the server is listening', async () => {
    const pool = { end: vi.fn(() => Promise.resolve()) };
    const shutdown = createShutdown({ pool, timeoutMs: 1_000 });

    await shutdown.run();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
