import type { RequestHandler } from 'express';
import { idParams } from '../../lib/params.js';
import { actorOf } from '../../middleware/auth.js';
import { updateProfileSchema } from '../users/user.model.js';
import { doctorProfileInputSchema, roleParams, updateDoctorProfileSchema, usersQuery } from './admin-users.model.js';
import type { AdminUserService } from './admin-users.service.js';

const idOf = (params: unknown) => idParams.parse(params).id;

export function createAdminUserController(service: AdminUserService) {
  return {
    page: (async (req, res) => {
      res.json(await service.page(usersQuery.parse(req.query)));
    }) satisfies RequestHandler,
    detail: (async (req, res) => {
      res.json(await service.detail(idOf(req.params)));
    }) satisfies RequestHandler,
    update: (async (req, res) => {
      res.json(await service.update(actorOf(req), idOf(req.params), updateProfileSchema.parse(req.body)));
    }) satisfies RequestHandler,
    impact: (async (req, res) => {
      res.json(await service.impact(idOf(req.params)));
    }) satisfies RequestHandler,
    deactivate: (async (req, res) => {
      res.json(await service.deactivate(actorOf(req), idOf(req.params)));
    }) satisfies RequestHandler,
    reactivate: (async (req, res) => {
      res.json(await service.reactivate(actorOf(req), idOf(req.params)));
    }) satisfies RequestHandler,
    passwordReset: (async (req, res) => {
      await service.sendPasswordReset(actorOf(req), idOf(req.params));
      res.status(202).end();
    }) satisfies RequestHandler,
    grantRole: (async (req, res) => {
      res.json(await service.grantAdmin(actorOf(req), roleParams.parse(req.params).id));
    }) satisfies RequestHandler,
    revokeRole: (async (req, res) => {
      res.json(await service.revokeAdmin(actorOf(req), roleParams.parse(req.params).id));
    }) satisfies RequestHandler,
    createDoctorProfile: (async (req, res) => {
      const input = doctorProfileInputSchema.parse(req.body);
      res.status(201).json(await service.createDoctorProfile(actorOf(req), idOf(req.params), input));
    }) satisfies RequestHandler,
    updateDoctorProfile: (async (req, res) => {
      const input = updateDoctorProfileSchema.parse(req.body);
      res.json(await service.updateDoctorProfile(actorOf(req), idOf(req.params), input));
    }) satisfies RequestHandler,
    deleteDoctorProfile: (async (req, res) => {
      res.json(await service.deleteDoctorProfile(actorOf(req), idOf(req.params)));
    }) satisfies RequestHandler,
  };
}

export type AdminUserController = ReturnType<typeof createAdminUserController>;
