import { and, desc, eq, gt, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../database/pg-client.js';
import { announcements } from '../../database/schema/announcements.js';
import type { Role } from '../../database/schema/users.js';
import { pageOf, type Page } from '../../lib/pagination.js';
import {
  MAX_VISIBLE_ANNOUNCEMENTS,
  type Announcement,
  type AnnouncementsQuery,
  type AnnouncementStatus,
  type VisibleAnnouncement,
} from './announcements.model.js';

const announcementColumns = {
  id: announcements.id,
  title: announcements.title,
  body: announcements.body,
  severity: announcements.severity,
  audienceRoles: announcements.audienceRoles,
  startsAt: announcements.startsAt,
  endsAt: announcements.endsAt,
  createdAt: announcements.createdAt,
  updatedAt: announcements.updatedAt,
};

type Row = typeof announcements.$inferSelect;
type Stored = Pick<Row, keyof typeof announcementColumns>;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type AnnouncementChanges = Partial<
  Pick<Row, 'title' | 'body' | 'severity' | 'audienceRoles' | 'startsAt' | 'endsAt'>
> &
  Pick<Row, 'updatedBy'>;

const statusFilters = (now: Date): Record<AnnouncementStatus, SQL | undefined> => ({
  scheduled: gt(announcements.startsAt, now),
  active: and(lte(announcements.startsAt, now), or(isNull(announcements.endsAt), gt(announcements.endsAt, now))),
  ended: lte(announcements.endsAt, now),
});

export function statusAt(row: Pick<Row, 'startsAt' | 'endsAt'>, now: Date): AnnouncementStatus {
  if (row.startsAt > now) return 'scheduled';
  return row.endsAt && row.endsAt <= now ? 'ended' : 'active';
}

function toAnnouncement(row: Stored, now: Date): Announcement {
  return {
    ...row,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    status: statusAt(row, now),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AnnouncementsRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async page({ status, page, pageSize }: AnnouncementsQuery, now: Date): Promise<Page<Announcement>> {
    const where = status ? statusFilters(now)[status] : undefined;
    const query = this.db
      .select(announcementColumns)
      .from(announcements)
      .where(where)
      .orderBy(desc(announcements.id))
      .$dynamic();
    const result = await pageOf(query, { page, pageSize }, () => this.db.$count(announcements, where));
    return { ...result, items: result.items.map((row) => toAnnouncement(row, now)) };
  }

  async visible(role: Role, now: Date): Promise<VisibleAnnouncement[]> {
    const rows = await this.db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        severity: announcements.severity,
        startsAt: announcements.startsAt,
        endsAt: announcements.endsAt,
      })
      .from(announcements)
      .where(and(statusFilters(now).active, sql`${announcements.audienceRoles} @> array[${role}]::text[]`))
      .orderBy(
        sql`case ${announcements.severity} when 'critical' then 0 else 1 end`,
        desc(announcements.startsAt),
        desc(announcements.id),
      )
      .limit(MAX_VISIBLE_ANNOUNCEMENTS);
    return rows.map((row) => ({
      ...row,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt?.toISOString() ?? null,
    }));
  }

  async lock(tx: Transaction, id: string): Promise<Row | undefined> {
    const [row] = await tx.select().from(announcements).where(eq(announcements.id, id)).for('no key update');
    return row;
  }

  async insert(tx: Transaction, values: NewAnnouncement, now: Date): Promise<Announcement> {
    const [row] = await tx.insert(announcements).values(values).returning(announcementColumns);
    if (!row) throw new Error('Insert into announcements returned no row');
    return toAnnouncement(row, now);
  }

  async update(tx: Transaction, id: string, changes: AnnouncementChanges, now: Date): Promise<Announcement> {
    const [row] = await tx.update(announcements).set(changes).where(eq(announcements.id, id)).returning(announcementColumns);
    if (!row) throw new Error('Update of announcements returned no row');
    return toAnnouncement(row, now);
  }

  async remove(tx: Transaction, id: string): Promise<void> {
    await tx.delete(announcements).where(eq(announcements.id, id));
  }
}
