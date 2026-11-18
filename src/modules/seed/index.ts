import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import type { LabIntegrationService } from '../lab-integration/lab-integration.service.js';
import type { UserService } from '../users/user.service.js';
import { SeedRepository } from './seed.repository.js';
import { SeedService } from './seed.service.js';

export interface SeedModuleDeps {
  db: Database;
  users: UserService;
  schedules: DoctorScheduleService;
  clock: Clock;
  lab: LabIntegrationService;
}

export function createSeedModule({ db, users, schedules, clock, lab }: SeedModuleDeps) {
  return { service: new SeedService(new SeedRepository(db), users, schedules, clock, lab) };
}
