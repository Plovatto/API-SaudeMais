import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/app-error.js';

const clients = new WeakMap<Request, string>();

export const INVALID_API_KEY_MESSAGE = 'Chave de API ausente, inválida ou revogada.';

export function createRequireApiKey(authenticate: (apiKey: string) => Promise<string | null>): RequestHandler {
  return async (req, _res, next) => {
    const clientId = await authenticate(req.get('x-api-key') ?? '');
    if (!clientId) throw new AppError(401, 'INVALID_API_KEY', INVALID_API_KEY_MESSAGE);
    clients.set(req, clientId);
    next();
  };
}

export function clientOf(req: Request): string {
  const clientId = clients.get(req);
  if (!clientId) throw new Error('requireApiKey must run before this handler');
  return clientId;
}
