import type { RequestHandler } from 'express';
import { actorOf, authOf } from '../../middleware/auth.js';
import { saveScheduleSchema } from './doctor-schedule.model.js';
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
  };
}

export type DoctorScheduleController = ReturnType<typeof createDoctorScheduleController>;
