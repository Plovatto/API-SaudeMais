import { asc, inArray, lt, lte, sql } from 'drizzle-orm';
import { logger } from '../config/logger.js';
import type { Database, Transaction } from '../database/pg-client.js';
import { settings } from '../database/schema/catalog.js';
import { auditLogs } from '../database/schema/audit-logs.js';
import { notifications } from '../database/schema/notifications.js';
import { passwordResetTokens } from '../database/schema/password-reset-tokens.js';
import { sessions } from '../database/schema/sessions.js';
import type { Clock } from '../lib/clock.js';
import { readSettings } from '../lib/settings.js';
import { DAY, HOUR } from '../lib/time.js';
import type { BookingsService } from '../modules/bookings/bookings.service.js';
import type { EmailNotifier } from '../modules/email-notifications/email-notifications.notifier.js';
import type { NotificationsService } from '../modules/notifications/notifications.service.js';

const MAINTENANCE_LOCK = 727_004;

const RESET_TOKEN_RETENTION = 48 * HOUR;
const AUDIT_PURGE_BATCH = 5000;

async function purgeAuditLogs(tx: Transaction, before: Date): Promise<number> {
  let purged = 0;
  for (;;) {
    const batch = await tx
      .delete(auditLogs)
      .where(
        inArray(
          auditLogs.id,
          tx
            .select({ id: auditLogs.id })
            .from(auditLogs)
            .where(lt(auditLogs.createdAt, before))
            .orderBy(asc(auditLogs.createdAt))
            .limit(AUDIT_PURGE_BATCH),
        ),
      )
      .returning({ id: auditLogs.id });
    purged += batch.length;
    if (batch.length < AUDIT_PURGE_BATCH) return purged;
  }
}

interface MaintenanceDeps {
  db: Database;
  clock: Clock;
  bookings: BookingsService;
  notifications: NotificationsService;
  reminders: Pick<EmailNotifier, 'remindUpcoming'>;
  resetExample?: () => Promise<boolean>;
}

type LockRow = { acquired: boolean };

export function createMaintenance({
  db,
  clock,
  bookings,
  notifications: notificationsService,
  reminders,
  resetExample,
}: MaintenanceDeps) {
  let lastExampleReset = 0;
  const restoreExample = async () => {
    const now = clock.now().getTime();
    if (!resetExample || (lastExampleReset > 0 && now - lastExampleReset < DAY)) return false;
    try {
      const restored = await resetExample();
      lastExampleReset = now;
      return restored;
    } catch (err) {
      logger.error({ err }, 'Example account reset failed');
      return false;
    }
  };

  const purge = async () => {
    const { purged, recipients } = await db.transaction(async (tx) => {
      const now = clock.now();
      const before = (age: number) => new Date(now.getTime() - age);
      const retention = await readSettings(tx, {
        notificationDays: settings.notificationRetentionDays,
        auditDays: settings.auditRetentionDays,
      });
      const deleted = async (rows: PromiseLike<unknown[]>) => (await rows).length;
      const oldNotifications = await tx
        .delete(notifications)
        .where(lt(notifications.createdAt, before(retention.notificationDays * DAY)))
        .returning({ userId: notifications.userId, audienceRole: notifications.audienceRole });
      return {
        recipients: oldNotifications,
        purged: {
          sessions: await deleted(
            tx.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id }),
          ),
          resetTokens: await deleted(
            tx
              .delete(passwordResetTokens)
              .where(lt(passwordResetTokens.expiresAt, before(RESET_TOKEN_RETENTION)))
              .returning({ id: passwordResetTokens.id }),
          ),
          notifications: oldNotifications.length,
          auditLogs: await purgeAuditLogs(tx, before(retention.auditDays * DAY)),
        },
      };
    });
    notificationsService.forget(recipients);
    return purged;
  };

  const run = async () => ({
    expired: await bookings.expireOverdue(),
    examsCompleted: await bookings.completeEndedExams(),
    appointmentsCompleted: await bookings.completeStaleAppointments(),
    remindersSent: await reminders.remindUpcoming(),
    purged: await purge(),
    exampleRestored: await restoreExample(),
  });

  const runExclusive = () =>
    db.transaction(async (tx) => {
      const { rows } = (await tx.execute<LockRow>(
        sql`select pg_try_advisory_xact_lock(${MAINTENANCE_LOCK}, 0) as acquired`,
      )) as { rows: LockRow[] };
      if (!rows[0]?.acquired) {
        logger.warn('Maintenance skipped: another run is in progress');
        return undefined;
      }
      await tx.execute(sql`set local idle_in_transaction_session_timeout = '10min'`);
      const report = await run();
      logger.info({ report }, 'Maintenance finished');
      return report;
    });

  return { run, runExclusive };
}
