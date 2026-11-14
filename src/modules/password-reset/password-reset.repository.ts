import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { passwordResetTokens } from '../../database/schema/password-reset-tokens.js';
import { users } from '../../database/schema/users.js';
import { recordAudit, type AuditEntry } from '../../lib/audit.js';
import { applyNewPassword } from '../users/user.repository.js';

const LOCK_NAMESPACE = 727_002;

export interface ResetLimits {
  perUserPerDay: number;
  globalPerDay: number;
  minIntervalMs: number;
}

export interface NewResetToken {
  userId: string;
  requestedBy: string | null;
  tokenHash: string;
  now: Date;
  expiresAt: Date;
  dayStart: Date;
  audit?: AuditEntry | undefined;
}

const open = and(isNull(passwordResetTokens.usedAt), isNull(passwordResetTokens.revokedAt));

export class PasswordResetRepository {
  constructor(
    private readonly db: Database,
    private readonly limits: ResetLimits,
  ) {}

  issue({ userId, requestedBy, tokenHash, now, expiresAt, dayStart, audit }: NewResetToken): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, 0)`);
      const recentSince = new Date(now.getTime() - this.limits.minIntervalMs);
      const since = recentSince < dayStart ? recentSince : dayStart;
      const [today] = await tx
        .select({
          total: sql<number>`count(*) filter (where ${passwordResetTokens.createdAt} >= ${dayStart})::int`,
          forUser: sql<number>`count(*) filter (where ${passwordResetTokens.userId} = ${userId} and ${passwordResetTokens.createdAt} >= ${dayStart})::int`,
          recent: sql<number>`count(*) filter (where ${passwordResetTokens.userId} = ${userId} and ${passwordResetTokens.createdAt} > ${recentSince})::int`,
        })
        .from(passwordResetTokens)
        .where(gte(passwordResetTokens.createdAt, since));
      if (
        !today ||
        today.total >= this.limits.globalPerDay ||
        today.forUser >= this.limits.perUserPerDay ||
        today.recent > 0
      ) {
        return false;
      }
      await tx
        .update(passwordResetTokens)
        .set({ revokedAt: now })
        .where(and(eq(passwordResetTokens.userId, userId), open));
      await tx
        .insert(passwordResetTokens)
        .values({ userId, requestedBy, tokenHash, createdAt: now, expiresAt, sentAt: now });
      if (audit) await recordAudit(tx, audit);
      return true;
    });
  }

  consume(tokenHash: string, passwordHash: string, now: Date): Promise<string | undefined> {
    return this.db.transaction(async (tx) => {
      const [token] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokens.tokenHash, tokenHash), open, gt(passwordResetTokens.expiresAt, now)))
        .returning({ userId: passwordResetTokens.userId });
      if (!token) return undefined;
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, token.userId), isNull(users.deactivatedAt), eq(users.isProtected, false)))
        .for('no key update');
      if (!user) return undefined;
      await applyNewPassword(tx, user.id, passwordHash, null, now);
      return user.id;
    });
  }
}
