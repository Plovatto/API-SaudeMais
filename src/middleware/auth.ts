import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/app-error.js';
import type { Role } from '../database/schema/users.js';
import type { AuthContext, UserService } from '../modules/users/user.service.js';

const contexts = new WeakMap<Request, AuthContext>();

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.');

export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

export function createRequireAuth(service: Pick<UserService, 'authenticate'>): RequestHandler {
  return async (req, _res, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
    const context = await service.authenticate(token ?? '');
    if (!context) throw unauthenticated();
    contexts.set(req, context);
    next();
  };
}

export function createRequireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!authOf(req).user.roles.includes(role)) {
      throw new AppError(403, 'FORBIDDEN', 'Você não tem acesso a esta área.');
    }
    next();
  };
}

export function createRequireWritable(): RequestHandler {
  return (req, _res, next) => {
    if (authOf(req).isProtected) {
      throw new AppError(403, 'PROTECTED_ACCOUNT', 'Esta é uma conta de demonstração e não pode ser alterada.');
    }
    next();
  };
}

export function authOf(req: Request): AuthContext {
  const context = contexts.get(req);
  if (!context) throw new Error('requireAuth must run before this handler');
  return context;
}
