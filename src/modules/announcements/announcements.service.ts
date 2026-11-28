import type { Role } from '../../database/schema/users.js';
import { invalidData, notFound } from '../../lib/app-error.js';
import { recordAudit, type Actor } from '../../lib/audit.js';
import type { Clock } from '../../lib/clock.js';
import { definedFields } from '../../lib/defined.js';
import { announcementNotFound, endNotAfterStart } from './announcements.messages.js';
import type {
  AnnouncementsQuery,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcements.model.js';
import type { AnnouncementChanges, AnnouncementsRepository } from './announcements.repository.js';

const entity = 'announcement';

const dateOrNull = (value: string | null | undefined) => (value ? new Date(value) : null);

export class AnnouncementsService {
  constructor(
    private readonly repository: AnnouncementsRepository,
    private readonly clock: Clock,
  ) {}

  page(query: AnnouncementsQuery) {
    return this.repository.page(query, this.clock.now());
  }

  async visible(role: Role) {
    return { items: await this.repository.visible(role, this.clock.now()) };
  }

  create(actor: Actor, input: CreateAnnouncementInput) {
    const now = this.clock.now();
    const startsAt = input.startsAt ? new Date(input.startsAt) : now;
    const endsAt = dateOrNull(input.endsAt);
    if (endsAt && endsAt <= startsAt) throw invalidData({ endsAt: endNotAfterStart });
    return this.repository.transaction(async (tx) => {
      const created = await this.repository.insert(
        tx,
        {
          title: input.title,
          body: input.body,
          severity: input.severity,
          audienceRoles: input.audienceRoles,
          startsAt,
          endsAt,
          createdBy: actor.actorId,
          updatedBy: actor.actorId,
        },
        now,
      );
      await recordAudit(tx, {
        ...actor,
        action: 'announcement.created',
        entityType: entity,
        entityId: created.id,
        metadata: {
          title: created.title,
          severity: created.severity,
          audienceRoles: created.audienceRoles.join(','),
          startsAt: created.startsAt,
          endsAt: created.endsAt,
        },
      });
      return created;
    });
  }

  update(actor: Actor, id: string, input: UpdateAnnouncementInput) {
    const now = this.clock.now();
    const { startsAt, endsAt, ...rest } = input;
    const changes = definedFields({
      ...rest,
      ...(startsAt && { startsAt: new Date(startsAt) }),
      ...(endsAt !== undefined && { endsAt: dateOrNull(endsAt) }),
    });
    return this.repository.transaction(async (tx) => {
      const current = await this.repository.lock(tx, id);
      if (!current) throw notFound(announcementNotFound);
      const nextStart = changes.startsAt ?? current.startsAt;
      const nextEnd = changes.endsAt === undefined ? current.endsAt : changes.endsAt;
      if (nextEnd && nextEnd <= nextStart) {
        throw invalidData({ [endsAt !== undefined ? 'endsAt' : 'startsAt']: endNotAfterStart });
      }
      const updated = await this.repository.update(
        tx,
        id,
        { ...changes, updatedBy: actor.actorId } satisfies AnnouncementChanges,
        now,
      );
      await recordAudit(tx, {
        ...actor,
        action: 'announcement.updated',
        entityType: entity,
        entityId: id,
        metadata: { fields: Object.keys(changes) },
      });
      return updated;
    });
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.repository.transaction(async (tx) => {
      const current = await this.repository.lock(tx, id);
      if (!current) throw notFound(announcementNotFound);
      await this.repository.remove(tx, id);
      await recordAudit(tx, {
        ...actor,
        action: 'announcement.deleted',
        entityType: entity,
        entityId: id,
        metadata: { title: current.title },
      });
    });
  }
}
