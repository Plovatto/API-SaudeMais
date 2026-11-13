import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/app-error.js';
import type { AuthContext, UserService } from '../modules/users/user.service.js';

const contexts = new WeakMap<Request, AuthContext>();

export function createRequireAuth(service: Pick<UserService, 'authenticate'>): RequestHandler {
  return async (req, _res, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
    const context = await service.authenticate(token ?? '');
    if (!context) throw new AppError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.');
    contexts.set(req, context);
    next();
  };
}

export function authOf(req: Request): AuthContext {
  const context = contexts.get(req);
  if (!context) throw new Error('requireAuth must run before this handler');
  return context;
}
