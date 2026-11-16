import { lt, lte, sql } from 'drizzle-orm';
import { logger } from '../config/logger.js';
import type { Database } from '../database/pg-client.js';
import { auditLogs } from '../database/schema/audit-logs.js';
import { settings } from '../database/schema/catalog.js';
import { notifications } from '../database/schema/notifications.js';
import { passwordResetTokens } from '../database/schema/password-reset-tokens.js';
import { sessions } from '../database/schema/sessions.js';
import type { Clock } from '../lib/clock.js';
import { DAY, HOUR } from '../lib/time.js';
import type { BookingsService } from '../modules/bookings/bookings.service.js';
import type { DemoService } from '../modules/demo/demo.service.js';

const MAINTENANCE_LOCK = 727_004;

const RETENTION = {
  resetTokens: 48 * HOUR,
  notifications: 90 * DAY,
  auditLogs: 180 * DAY,
};

export interface MaintenanceDeps {
  db: Database;
  clock: Clock;
  bookings: BookingsService;
  demo: DemoService;
}

export interface MaintenanceOptions {
  restoreDemo: boolean;
}

export function createMaintenance({ db, clock, bookings, demo }: MaintenanceDeps) {
  const purge = () =>
    db.transaction(async (tx) => {
      const now = clock.now();
      const before = (age: number) => new Date(now.getTime() - age);
      const deleted = async (rows: PromiseLike<unknown[]>) => (await rows).length;
      return {
        sessions: await deleted(tx.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id })),
        resetTokens: await deleted(
          tx
            .delete(passwordResetTokens)
            .where(lt(passwordResetTokens.createdAt, before(RETENTION.resetTokens)))
            .returning({ id: passwordResetTokens.id }),
        ),
        notifications: await deleted(
          tx
            .delete(notifications)
            .where(lt(notifications.createdAt, before(RETENTION.notifications)))
            .returning({ id: notifications.id }),
        ),
        auditLogs: await deleted(
          tx
            .delete(auditLogs)
            .where(lt(auditLogs.createdAt, before(RETENTION.auditLogs)))
            .returning({ id: auditLogs.id }),
        ),
      };
    });

  const run = async ({ restoreDemo }: MaintenanceOptions) => ({
    expired: await bookings.expireOverdue(),
    examsCompleted: await bookings.completeEndedExams(),
    appointmentsCompleted: await bookings.completeStaleAppointments(),
    purged: await purge(),
    demoRestored: (restoreDemo && (await demo.restore())) || null,
  });

  const runExclusive = (options: MaintenanceOptions) =>
    db.transaction(async (tx) => {
      const [lock] = await tx
        .select({ acquired: sql<boolean>`pg_try_advisory_xact_lock(${MAINTENANCE_LOCK}, 0)` })
        .from(settings);
      if (!lock?.acquired) {
        logger.info('Maintenance skipped: another run is in progress');
        return undefined;
      }
      await tx.execute(sql`set local idle_in_transaction_session_timeout = 0`);
      const report = await run(options);
      logger.info({ report }, 'Maintenance finished');
      return report;
    });

  return { run, runExclusive };
}
