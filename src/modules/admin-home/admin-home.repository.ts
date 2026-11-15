import { and, count, countDistinct, eq, gte, isNull, lt, ne } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { bookings } from '../../database/schema/bookings.js';
import { userRoles, users, type Role } from '../../database/schema/users.js';
import type { DayRange } from '../../lib/time.js';

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

  async appointmentsBetween({ start, end }: DayRange): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.patientId))
      .where(
        and(
          eq(bookings.kind, 'appointment'),
          ne(bookings.status, 'cancelled'),
          eq(users.isProtected, false),
          gte(bookings.startsAt, start),
          lt(bookings.startsAt, end),
        ),
      );
    return row?.total ?? 0;
  }
}
