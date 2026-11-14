import type { Database } from '../database/pg-client.js';
import type { Clock } from '../lib/clock.js';
import type { MailQueue } from '../mail/index.js';
import { createAdminHomeModule } from './admin-home/index.js';
import { createAdminUsersModule } from './admin-users/index.js';
import { createAppointmentsModule } from './appointments/index.js';
import { createBookingsModule } from './bookings/index.js';
import { createCatalogModule } from './catalog/index.js';
import { createDoctorScheduleModule } from './doctor-schedule/index.js';
import { createDoctorsModule } from './doctors/index.js';
import { createDemoModule } from './demo/index.js';
import { createNotificationsModule } from './notifications/index.js';
import { createPasswordResetModule } from './password-reset/index.js';
import { createUsersModule, type SessionPolicy } from './users/index.js';
import { SessionCache } from './users/user.session-cache.js';

export interface ModulesDeps {
  db: Database;
  clock: Clock;
  policy: SessionPolicy;
  mail: MailQueue;
  appUrl: string;
}

export function createModules(deps: ModulesDeps) {
  const sessions = new SessionCache(deps.clock);
  const notifications = createNotificationsModule(deps);
  const users = createUsersModule({ ...deps, notifications: notifications.service, sessions });
  const passwordReset = createPasswordResetModule({ ...deps, sessions });
  const bookings = createBookingsModule({ clock: deps.clock, notifications: notifications.service });
  const catalog = createCatalogModule({ db: deps.db, clock: deps.clock, requireAuth: users.requireAuth });
  const adminUsers = createAdminUsersModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    passwordReset: passwordReset.service,
    sessions,
    bookings: bookings.service,
  });
  const doctorSchedule = createDoctorScheduleModule({ db: deps.db, requireAuth: users.requireAuth });
  const demo = createDemoModule({
    db: deps.db,
    users: users.service,
    schedules: doctorSchedule.service,
    clock: deps.clock,
  });
  const doctors = createDoctorsModule({ db: deps.db, clock: deps.clock, requireAuth: users.requireAuth });
  const appointments = createAppointmentsModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    notifications: notifications.service,
  });
  const adminHome = createAdminHomeModule({ db: deps.db, clock: deps.clock, requireAuth: users.requireAuth });
  return {
    users,
    passwordReset,
    catalog,
    adminUsers,
    demo,
    adminHome,
    doctorSchedule,
    doctors,
    appointments,
    notifications,
    routers: [
      users.router,
      passwordReset.router,
      catalog.router,
      adminUsers.router,
      adminHome.router,
      doctorSchedule.router,
      doctors.router,
      appointments.router,
      notifications.routerFor(users.requireAuth),
    ],
  };
}
