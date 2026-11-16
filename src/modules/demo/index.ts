import type { Database } from '../../database/pg-client.js';
import type { Clock } from '../../lib/clock.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { DoctorScheduleService } from '../doctor-schedule/doctor-schedule.service.js';
import type { LabIntegrationService } from '../lab-integration/lab-integration.service.js';
import type { UserService } from '../users/user.service.js';
import { DemoRepository } from './demo.repository.js';
import { DemoService } from './demo.service.js';

export interface DemoModuleDeps {
  db: Database;
  users: UserService;
  schedules: DoctorScheduleService;
  clock: Clock;
  notifications: NotificationsService;
  lab: LabIntegrationService;
}

export function createDemoModule({ db, users, schedules, clock, notifications, lab }: DemoModuleDeps) {
  return { service: new DemoService(new DemoRepository(db), users, schedules, clock, notifications, lab) };
}
