import type { Server } from 'node:http';

interface ShutdownOptions {
  pool: { end: () => Promise<void> };
  flush?: () => Promise<void>;
  timeoutMs: number;
}

function drain(server: Server, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    server.on('request', (_req, res) => res.setHeader('Connection', 'close'));
    const idleSweep = setInterval(() => server.closeIdleConnections(), 250);
    idleSweep.unref();
    const deadline = setTimeout(() => server.closeAllConnections(), timeoutMs);
    deadline.unref();
    server.close(() => {
      clearInterval(idleSweep);
      clearTimeout(deadline);
      resolve();
    });
    server.closeIdleConnections();
  });
}

export function createShutdown({ pool, flush, timeoutMs }: ShutdownOptions) {
  let server: Server | undefined;
  let running: Promise<void> | undefined;
  return {
    attach(listening: Server) {
      server = listening;
    },
    run(): Promise<void> {
      running ??= (server ? drain(server, timeoutMs) : Promise.resolve()).then(() => flush?.()).then(() => pool.end());
      return running;
    },
  };
}
