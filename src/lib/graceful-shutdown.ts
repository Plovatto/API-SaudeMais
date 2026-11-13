import type { Server } from 'node:http';

interface ShutdownOptions {
  server: Server;
  pool: { end: () => Promise<void> };
  timeoutMs: number;
}

function closeServer(server: Server, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, timeoutMs);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}

export function createShutdown({ server, pool, timeoutMs }: ShutdownOptions): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => {
    running ??= closeServer(server, timeoutMs).then(() => pool.end());
    return running;
  };
}
