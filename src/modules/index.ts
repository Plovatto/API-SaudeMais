import type { Env } from '../config/env.js';
import type { Database } from '../database/pg-client.js';
import { createMaintenance } from '../jobs/maintenance.js';
import { systemClock, type Clock } from '../lib/clock.js';
import type { MailQueue } from '../mail/index.js';
import { createAdminHomeModule } from './admin-home/index.js';
import { createAdminUsersModule } from './admin-users/index.js';
import { createAppointmentsModule } from './appointments/index.js';
import { createBookingsModule } from './bookings/index.js';
import { createCatalogModule } from './catalog/index.js';
import { createDoctorAgendaModule } from './doctor-agenda/index.js';
import { createDoctorScheduleModule } from './doctor-schedule/index.js';
import { createDoctorsModule } from './doctors/index.js';
import { createDemoModule } from './demo/index.js';
import { createExamBookingsModule } from './exam-bookings/index.js';
import { createLabIntegrationModule } from './lab-integration/index.js';
import { createNotificationsModule } from './notifications/index.js';
import { createPasswordResetModule } from './password-reset/index.js';
import { createPatientBookingsModule } from './patient-bookings/index.js';
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
  const bookings = createBookingsModule({ db: deps.db, clock: deps.clock, notifications: notifications.service });
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
    notifications: notifications.service,
  });
  const doctors = createDoctorsModule({ db: deps.db, clock: deps.clock, requireAuth: users.requireAuth });
  const appointments = createAppointmentsModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    notifications: notifications.service,
    bookings: bookings.service,
  });
  const examBookings = createExamBookingsModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    bookings: bookings.service,
  });
  const patientBookings = createPatientBookingsModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    notifications: notifications.service,
  });
  const doctorAgenda = createDoctorAgendaModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    notifications: notifications.service,
  });
  const labIntegration = createLabIntegrationModule({
    db: deps.db,
    clock: deps.clock,
    requireAuth: users.requireAuth,
    notifications: notifications.service,
  });
  const adminHome = createAdminHomeModule({ db: deps.db, clock: deps.clock, requireAuth: users.requireAuth });
  const maintenance = createMaintenance({
    db: deps.db,
    clock: deps.clock,
    bookings: bookings.service,
    demo: demo.service,
    notifications: notifications.service,
  });
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
    maintenance,
    routers: [
      users.router,
      passwordReset.router,
      catalog.router,
      adminUsers.router,
      adminHome.router,
      doctorSchedule.router,
      doctors.router,
      appointments.router,
      examBookings.router,
      patientBookings.router,
      doctorAgenda.router,
      labIntegration.router,
      notifications.routerFor(users.requireAuth),
    ],
  };
}

export function createModulesFromEnv(
  config: Pick<Env, 'APP_PUBLIC_URL' | 'SESSION_TTL_HOURS' | 'SESSION_REMEMBER_DAYS'>,
  db: Database,
  mail: MailQueue,
) {
  return createModules({
    db,
    mail,
    clock: systemClock,
    appUrl: config.APP_PUBLIC_URL,
    policy: { idleHours: config.SESSION_TTL_HOURS, maxDays: config.SESSION_REMEMBER_DAYS, maxSessionsPerUser: 10 },
  });
}
