import type { AfterCommit, Transaction } from '../../database/pg-client.js';
import type { Role } from '../../database/schema/users.js';
import { AppError } from '../../lib/app-error.js';
import type { Clock } from '../../lib/clock.js';
import type { Pagination } from '../../lib/pagination.js';
import type { TtlCache } from '../../lib/ttl-cache.js';
import { notificationNotFound } from './notifications.messages.js';
import type { Area } from './notifications.model.js';
import type { NewNotification, NotificationsRepository } from './notifications.repository.js';

type Notice = Pick<NewNotification, 'type' | 'params' | 'bookingId'>;
type Delivery = Notice & Pick<NewNotification, 'userId' | 'audienceRole'>;

const keyOf = (userId: string, role: Role) => `${userId}:${role}`;

export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly counter: TtlCache<number>,
    private readonly clock: Clock,
  ) {}

  async notify(tx: Transaction, deliveries: Delivery[]): Promise<AfterCommit> {
    if (deliveries.length === 0) return () => undefined;
    const createdAt = this.clock.now();
    await this.repository.insert(
      tx,
      deliveries.map((delivery) => ({ ...delivery, createdAt })),
    );
    return () => {
      for (const { userId, audienceRole } of deliveries) this.counter.delete(keyOf(userId, audienceRole));
    };
  }

  async notifyAdmins(tx: Transaction, notice: Notice): Promise<AfterCommit> {
    const admins = await this.repository.activeAdminIds(tx);
    return this.notify(
      tx,
      admins.map((userId) => ({ ...notice, userId, audienceRole: 'admin' })),
    );
  }

  page(area: Area, pagination: Pagination) {
    return this.repository.page(area, pagination);
  }

  unreadCount(area: Area): Promise<number> {
    return this.counter.resolve(keyOf(area.userId, area.role), () => this.repository.unreadCount(area));
  }

  async markRead(userId: string, id: string): Promise<void> {
    const role = await this.repository.markRead(userId, id, this.clock.now());
    if (!role) throw new AppError(404, 'NOT_FOUND', notificationNotFound);
    this.counter.delete(keyOf(userId, role));
  }

  async markAllRead(area: Area): Promise<void> {
    await this.repository.markAllRead(area, this.clock.now());
    this.counter.delete(keyOf(area.userId, area.role));
  }
}
