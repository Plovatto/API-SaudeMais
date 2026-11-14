import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import type { UserService } from '../users/user.service.js';
import { DemoRepository } from './demo.repository.js';
import { DemoService } from './demo.service.js';

export interface DemoModuleDeps {
  db: Database;
  users: UserService;
  schedules: DoctorScheduleService;
  clock: Clock;
}

export function createDemoModule({ db, users, schedules, clock }: DemoModuleDeps) {
  return { service: new DemoService(new DemoRepository(db), users, schedules, clock) };
}
