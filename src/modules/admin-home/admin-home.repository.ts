import { and, count, countDistinct, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../../database/pg-client.js';
import { bookings, effectiveStatus, type BookingStatus } from '../../database/schema/bookings.js';
import { userRoles, users, type Role } from '../../database/schema/users.js';
import type { DayRange } from '../../lib/time.js';
import { startsWithin } from '../bookings/bookings.repository.js';

const countedToday: BookingStatus[] = ['pending', 'confirmed', 'completed', 'no_show'];

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

  async appointmentsBetween(day: DayRange, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.patientId))
      .where(
        and(
          eq(bookings.kind, 'appointment'),
          inArray(effectiveStatus(now), countedToday),
          eq(users.isProtected, false),
          startsWithin(day),
        ),
      );
    return row?.total ?? 0;
  }
}
