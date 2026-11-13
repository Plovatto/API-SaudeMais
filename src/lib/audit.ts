import type { Database } from '../database/pg-client.js';
import { auditLogs } from '../database/schema/audit-logs.js';

export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip: string | null;
}

export async function recordAudit(
  db: Pick<Database, 'insert'>,
  { metadata = {}, ...entry }: AuditEntry,
): Promise<void> {
  await db.insert(auditLogs).values({ actorType: 'user', metadata, ...entry });
}
