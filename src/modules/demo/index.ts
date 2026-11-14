import type { Database } from '../../database/pg-client.js';
import type { UserService } from '../users/user.service.js';
import { DemoRepository } from './demo.repository.js';
import { DemoService } from './demo.service.js';

export interface DemoModuleDeps {
  db: Database;
  users: UserService;
}

export function createDemoModule({ db, users }: DemoModuleDeps) {
  return { service: new DemoService(new DemoRepository(db), users) };
}
