import type { RequestHandler } from 'express';
import { actorOf, authOf } from '../../middleware/auth.js';
import { createTimeOffSchema, saveScheduleSchema, timeOffParams } from './doctor-schedule.model.js';
import type { DoctorScheduleService } from './doctor-schedule.service.js';

export function createDoctorScheduleController(service: DoctorScheduleService) {
  return {
    schedule: (async (req, res) => {
      res.json(await service.schedule(authOf(req).user.id));
    }) satisfies RequestHandler,
    save: (async (req, res) => {
      const input = saveScheduleSchema.parse(req.body);
      res.json(await service.save(authOf(req).user.id, input, actorOf(req)));
    }) satisfies RequestHandler,
    timeOff: (async (req, res) => {
      res.json(await service.timeOff(authOf(req).user.id));
    }) satisfies RequestHandler,
    block: (async (req, res) => {
      const input = createTimeOffSchema.parse(req.body);
      res.status(201).json(await service.block(authOf(req).user.id, input, actorOf(req)));
    }) satisfies RequestHandler,
    unblock: (async (req, res) => {
      const { date } = timeOffParams.parse(req.params);
      await service.unblock(authOf(req).user.id, date, actorOf(req));
      res.status(204).end();
    }) satisfies RequestHandler,
  };
}

export type DoctorScheduleController = ReturnType<typeof createDoctorScheduleController>;
