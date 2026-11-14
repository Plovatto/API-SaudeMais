import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import { notifications } from '../../database/schema/notifications.js';
import { users, type Role } from '../../database/schema/users.js';
import { pageOf, type Page, type Pagination } from '../../lib/pagination.js';
import { hasRole } from '../users/user.repository.js';
import type { Area, NotificationView } from './notifications.model.js';

export type NewNotification = typeof notifications.$inferInsert;

const ofArea = ({ userId, role }: Area) => and(eq(notifications.userId, userId), eq(notifications.audienceRole, role));

export class NotificationsRepository {
  constructor(private readonly db: Database) {}

  async insert(tx: Transaction, rows: NewNotification[]): Promise<void> {
    await tx.insert(notifications).values(rows);
  }

  async activeAdminIds(tx: Transaction): Promise<string[]> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(isNull(users.deactivatedAt), hasRole('admin')));
    return rows.map((row) => row.id);
  }

  async page(area: Area, pagination: Pagination): Promise<Page<NotificationView>> {
    const where = ofArea(area);
    const query = this.db
      .select({
        id: notifications.id,
        type: notifications.type,
        params: notifications.params,
        bookingId: notifications.bookingId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .$dynamic();
    const result = await pageOf(query, pagination, () => this.db.$count(notifications, where));
    return {
      ...result,
      items: result.items.map(({ readAt, createdAt, ...row }) => ({
        ...row,
        readAt: readAt?.toISOString() ?? null,
        createdAt: createdAt.toISOString(),
      })),
    };
  }

  unreadCount(area: Area): Promise<number> {
    return this.db.$count(notifications, and(ofArea(area), isNull(notifications.readAt)));
  }

  async markRead(userId: string, id: string, now: Date): Promise<Role | undefined> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, ${now})` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ role: notifications.audienceRole });
    return row?.role;
  }

  async markAllRead(area: Area, now: Date): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(ofArea(area), isNull(notifications.readAt)));
  }
}
