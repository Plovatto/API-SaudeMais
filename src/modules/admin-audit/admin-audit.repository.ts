import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { auditLogs } from '../../database/schema/audit-logs.js';
import { users } from '../../database/schema/users.js';
import type { AuditLog, AuditLogsQuery } from './admin-audit.model.js';

export interface AuditFilters extends Pick<AuditLogsQuery, 'action' | 'actorId' | 'entityType' | 'entityId' | 'cursor'> {
  range: { start?: Date; end?: Date };
  limit: number;
}

type Row = Omit<AuditLog, 'createdAt' | 'actor'> & {
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
};

function toAuditLog({ createdAt, actorId, actorName, actorEmail, ...row }: Row): AuditLog {
  const known = actorId !== null && actorName !== null && actorEmail !== null;
  return {
    ...row,
    createdAt: createdAt.toISOString(),
    actor: known ? { id: actorId, fullName: actorName, email: actorEmail } : null,
  };
}

export class AdminAuditRepository {
  constructor(private readonly db: Database) {}

  async page({ action, actorId, entityType, entityId, cursor, range, limit }: AuditFilters): Promise<AuditLog[]> {
    const where = and(
      action ? eq(auditLogs.action, action) : undefined,
      actorId ? eq(auditLogs.actorId, actorId) : undefined,
      entityType ? eq(auditLogs.entityType, entityType) : undefined,
      entityId ? eq(auditLogs.entityId, entityId) : undefined,
      range.start ? gte(auditLogs.createdAt, range.start) : undefined,
      range.end ? lt(auditLogs.createdAt, range.end) : undefined,
      cursor ? lt(auditLogs.id, cursor) : undefined,
    );
    const rows = await this.db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        actorType: auditLogs.actorType,
        actorId: users.id,
        actorName: users.fullName,
        actorEmail: users.email,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        ip: auditLogs.ip,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.id))
      .limit(limit + 1);
    return rows.map(toAuditLog);
  }
}
