import { civilDayStartIn, CLINIC_TIME_ZONE } from '../../lib/time.js';
import type { AuditLogPage, AuditLogsQuery } from './admin-audit.model.js';
import type { AdminAuditRepository } from './admin-audit.repository.js';

export class AdminAuditService {
  constructor(private readonly repository: AdminAuditRepository) {}

  async page({ from, to, limit, ...filters }: AuditLogsQuery): Promise<AuditLogPage> {
    const range = {
      ...(from && { start: civilDayStartIn(CLINIC_TIME_ZONE, from) }),
      ...(to && { end: civilDayStartIn(CLINIC_TIME_ZONE, to, 1) }),
    };
    const rows = await this.repository.page({ ...filters, range, limit });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }
}
