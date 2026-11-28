import type { Database } from '../database/pg-client.js';
import { auditLogs, type ActorType, type AuditAction } from '../database/schema/audit-logs.js';

export interface AuditEntry {
  actorType?: ActorType;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip: string | null;
}

export interface Actor {
  actorId: string;
  ip: string | null;
}

export const systemActor = { actorType: 'system', actorId: null, ip: null } as const;

export type AuditActor = Actor | typeof systemActor;

export async function recordAudit(
  db: Pick<Database, 'insert'>,
  { metadata = {}, ...entry }: AuditEntry,
): Promise<void> {
  await db.insert(auditLogs).values({ actorType: 'user', metadata, ...entry });
}
