import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { authOf } from '../../middleware/auth.js';
import { loginSchema, registerSchema } from './user.model.js';
import type { UserService } from './user.service.js';

export interface UserController {
  register: RequestHandler;
  login: RequestHandler;
  logout: RequestHandler;
}

export function createUserController(service: UserService): UserController {
  return {
    register: async (req, res) => {
      const user = await service.register(registerSchema.parse(req.body));
      res.status(201).json(user);
    },
    login: async (req, res) => {
      const session = await service.login(loginSchema.parse(req.body), {
        ip: req.ip && isIP(req.ip) ? req.ip : null,
        userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      });
      res.set('Cache-Control', 'no-store').status(200).json(session);
    },
    logout: async (req, res) => {
      await service.logout(authOf(req).sessionId);
      res.status(204).end();
    },
  };
}
