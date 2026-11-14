import { and, countDistinct, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { userRoles, users, type Role } from '../../database/schema/users.js';

export interface DayRange {
  start: Date;
  end: Date;
}

export class AdminHomeRepository {
  constructor(private readonly db: Database) {}

  async activeAccounts(role: Role): Promise<number> {
    const [row] = await this.db
      .select({ total: countDistinct(users.id) })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(userRoles.role, role), isNull(users.deactivatedAt), eq(users.isProtected, false)));
    return row?.total ?? 0;
  }

  appointmentsBetween(_range: DayRange): Promise<number> {
    return Promise.resolve(0);
  }
}
