import { isIP } from 'node:net';
import type { RequestHandler } from 'express';
import { authOf } from '../../middleware/auth.js';
import { changePasswordSchema, loginSchema, registerSchema, updateProfileSchema } from './user.model.js';
import type { UserService } from './user.service.js';

export interface UserController {
  register: RequestHandler;
  login: RequestHandler;
  logout: RequestHandler;
  profile: RequestHandler;
  updateProfile: RequestHandler;
  changePassword: RequestHandler;
  sessions: RequestHandler;
  logoutEverywhere: RequestHandler;
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
      res.status(200).json(session);
    },
    logout: async (req, res) => {
      await service.logout(authOf(req).sessionId);
      res.status(204).end();
    },
    profile: async (req, res) => {
      res.json(await service.profile(authOf(req).user.id));
    },
    updateProfile: async (req, res) => {
      res.json(await service.updateProfile(authOf(req).user.id, updateProfileSchema.parse(req.body)));
    },
    changePassword: async (req, res) => {
      await service.changePassword(authOf(req), changePasswordSchema.parse(req.body));
      res.status(204).end();
    },
    sessions: async (req, res) => {
      res.json(await service.listSessions(authOf(req)));
    },
    logoutEverywhere: async (req, res) => {
      await service.logoutEverywhere(authOf(req));
      res.status(204).end();
    },
  };
}
