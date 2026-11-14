import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/app-error.js';
import type { Actor } from '../lib/audit.js';
import { clientIp } from '../lib/client-ip.js';
import type { Role } from '../database/schema/users.js';
import type { AuthContext, UserService } from '../modules/users/user.service.js';

const contexts = new WeakMap<Request, AuthContext>();

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.');

export const PROTECTED_ACCOUNT_MESSAGE = 'Esta é uma conta de demonstração e não pode ser alterada.';

export const protectedAccount = () => new AppError(403, 'PROTECTED_ACCOUNT', PROTECTED_ACCOUNT_MESSAGE);

export const forbidden = () => new AppError(403, 'FORBIDDEN', 'Você não tem acesso a esta área.');

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

export function ensureRole(req: Request, role: Role): void {
  if (!authOf(req).user.roles.includes(role)) throw forbidden();
}

export function createRequireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    ensureRole(req, role);
    next();
  };
}

export function createRequireWritable(): RequestHandler {
  return (req, _res, next) => {
    if (authOf(req).isProtected) {
      throw protectedAccount();
    }
    next();
  };
}

export function actorOf(req: Request): Actor {
  return { actorId: authOf(req).user.id, ip: clientIp(req) };
}

export function authOf(req: Request): AuthContext {
  const context = contexts.get(req);
  if (!context) throw new Error('requireAuth must run before this handler');
  return context;
}
