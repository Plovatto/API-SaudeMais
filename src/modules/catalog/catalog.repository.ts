import { and, asc, eq, exists, inArray } from 'drizzle-orm';
import type { AnyPgColumn, PgSelect, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../../database/pg-client.js';
import { examTypes, settings, specialties, unitExamOffers, unitHours, units } from '../../database/schema/catalog.js';
import { recordAudit, type AuditEntry } from '../../lib/audit.js';
import { offsetOf, type Page, type Pagination } from '../../lib/pagination.js';
import type {
  CreateExamTypeInput,
  CreateSpecialtyInput,
  CreateUnitInput,
  ExamOffer,
  ExamType,
  Policy,
  PolicyInput,
  SaveOfferInput,
  Specialty,
  Unit,
  UpdateExamTypeInput,
  UpdateSpecialtyInput,
  UpdateUnitInput,
} from './catalog.model.js';
import type { CatalogEntity } from './catalog.messages.js';

export type Actor = Omit<AuditEntry, 'action' | 'entityType' | 'entityId' | 'metadata'>;
export type ExamTypeStatus = 'missing' | 'inactive' | 'active';

export class InUseError extends Error {
  constructor() {
    super('Catalog entry is in use');
    this.name = 'InUseError';
  }
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const specialtyColumns = {
  id: specialties.id,
  name: specialties.name,
  council: specialties.council,
  appointmentDurationMin: specialties.appointmentDurationMin,
  isActive: specialties.isActive,
};

const unitColumns = {
  id: units.id,
  name: units.name,
  address: units.address,
  phone: units.phone,
  isActive: units.isActive,
};

const examTypeColumns = {
  id: examTypes.id,
  code: examTypes.code,
  name: examTypes.name,
  kind: examTypes.kind,
  durationMin: examTypes.durationMin,
  preparationNotes: examTypes.preparationNotes,
  isActive: examTypes.isActive,
};

const policyColumns = {
  appointmentLateWindowHours: settings.appointmentLateWindowHours,
  examLateWindowHours: settings.examLateWindowHours,
  maxReschedules: settings.maxReschedules,
  bookingHorizonDays: settings.bookingHorizonDays,
  minLeadMinutes: settings.minLeadMinutes,
  updatedAt: settings.updatedAt,
};

const lockable: Record<CatalogEntity, { table: PgTable; id: AnyPgColumn }> = {
  specialty: { table: specialties, id: specialties.id },
  unit: { table: units, id: units.id },
  exam_type: { table: examTypes, id: examTypes.id },
};

type UnitRow = Omit<Unit, 'hours'>;
type HourRow = Unit['hours'][number];
type PolicyRow = Omit<Policy, 'updatedAt'> & { updatedAt: Date };

export class CatalogRepository {
  constructor(private readonly db: Database) {}

  activeSpecialties(): Promise<Specialty[]> {
    return this.db
      .select(specialtyColumns)
      .from(specialties)
      .where(eq(specialties.isActive, true))
      .orderBy(asc(specialties.name));
  }

  activeExamTypes(): Promise<ExamType[]> {
    return this.db
      .select(examTypeColumns)
      .from(examTypes)
      .where(eq(examTypes.isActive, true))
      .orderBy(asc(examTypes.name));
  }

  async activeUnits(examTypeId: string | undefined): Promise<Unit[]> {
    const offersExam = examTypeId
      ? exists(
          this.db
            .select({ unitId: unitExamOffers.unitId })
            .from(unitExamOffers)
            .innerJoin(examTypes, eq(examTypes.id, unitExamOffers.examTypeId))
            .where(
              and(
                eq(unitExamOffers.unitId, units.id),
                eq(unitExamOffers.examTypeId, examTypeId),
                eq(unitExamOffers.isActive, true),
                eq(examTypes.isActive, true),
              ),
            ),
        )
      : undefined;
    const rows = await this.db
      .select(unitColumns)
      .from(units)
      .where(and(eq(units.isActive, true), offersExam))
      .orderBy(asc(units.name));
    return this.withHours(rows);
  }

  specialtyPage(pagination: Pagination): Promise<Page<Specialty>> {
    const query = this.db.select(specialtyColumns).from(specialties).orderBy(asc(specialties.name)).$dynamic();
    return this.pageOf(specialties, pagination, query);
  }

  async unitPage(pagination: Pagination): Promise<Page<Unit>> {
    const query = this.db.select(unitColumns).from(units).orderBy(asc(units.name)).$dynamic();
    const page = await this.pageOf(units, pagination, query);
    return { ...page, items: await this.withHours(page.items) };
  }

  examTypePage(pagination: Pagination): Promise<Page<ExamType>> {
    const query = this.db.select(examTypeColumns).from(examTypes).orderBy(asc(examTypes.name)).$dynamic();
    return this.pageOf(examTypes, pagination, query);
  }

  createSpecialty(input: CreateSpecialtyInput, actor: Actor): Promise<Specialty> {
    return this.createAudited('specialty', actor, (tx) =>
      tx.insert(specialties).values(input).returning(specialtyColumns),
    );
  }

  updateSpecialty(id: string, changes: UpdateSpecialtyInput, actor: Actor): Promise<Specialty | undefined> {
    return this.updateAudited('specialty', id, changes, actor, (tx) =>
      tx.update(specialties).set(changes).where(eq(specialties.id, id)).returning(specialtyColumns),
    );
  }

  createExamType(input: CreateExamTypeInput, actor: Actor): Promise<ExamType> {
    return this.createAudited('exam_type', actor, (tx) =>
      tx.insert(examTypes).values(input).returning(examTypeColumns),
    );
  }

  updateExamType(id: string, changes: UpdateExamTypeInput, actor: Actor): Promise<ExamType | undefined> {
    return this.updateAudited('exam_type', id, changes, actor, (tx) =>
      tx.update(examTypes).set(changes).where(eq(examTypes.id, id)).returning(examTypeColumns),
    );
  }

  async createUnit({ hours, ...input }: CreateUnitInput, actor: Actor): Promise<Unit> {
    const row = await this.createAudited('unit', actor, async (tx) => {
      const rows = await tx.insert(units).values(input).returning(unitColumns);
      const created = rows[0];
      if (created) await replaceHours(tx, created.id, hours);
      return rows;
    });
    return { ...row, hours: sortHours(hours) };
  }

  updateUnit(id: string, { hours, ...changes }: UpdateUnitInput, actor: Actor): Promise<Unit | undefined> {
    const audited = { ...changes, ...(hours && { hours: hours.length }) };
    return this.updateAudited('unit', id, audited, actor, async (tx) => {
      const [row] =
        Object.keys(changes).length > 0
          ? await tx.update(units).set(changes).where(eq(units.id, id)).returning(unitColumns)
          : await tx.select(unitColumns).from(units).where(eq(units.id, id));
      if (!row) return [];
      if (hours) await replaceHours(tx, id, hours);
      return this.withHours([row], tx);
    });
  }

  async unitExists(id: string): Promise<boolean> {
    return (await this.db.$count(units, eq(units.id, id))) > 0;
  }

  async examTypeStatus(id: string): Promise<ExamTypeStatus> {
    const [row] = await this.db.select({ isActive: examTypes.isActive }).from(examTypes).where(eq(examTypes.id, id));
    if (!row) return 'missing';
    return row.isActive ? 'active' : 'inactive';
  }

  offersOf(unitId: string): Promise<ExamOffer[]> {
    return this.db
      .select({
        examTypeId: unitExamOffers.examTypeId,
        examTypeName: examTypes.name,
        capacityPerSlot: unitExamOffers.capacityPerSlot,
        isActive: unitExamOffers.isActive,
      })
      .from(unitExamOffers)
      .innerJoin(examTypes, eq(examTypes.id, unitExamOffers.examTypeId))
      .where(eq(unitExamOffers.unitId, unitId))
      .orderBy(asc(examTypes.name));
  }

  saveOffer(unitId: string, examTypeId: string, input: SaveOfferInput, actor: Actor): Promise<void> {
    return this.db.transaction(async (tx) => {
      await lockRow(tx, 'unit', unitId);
      if (await this.capacityInUseAbove(tx, unitId, examTypeId, input.capacityPerSlot)) throw new InUseError();
      await tx
        .insert(unitExamOffers)
        .values({ unitId, examTypeId, ...input })
        .onConflictDoUpdate({ target: [unitExamOffers.unitId, unitExamOffers.examTypeId], set: input });
      await recordAudit(tx, {
        ...actor,
        action: 'unit_exam_offer.saved',
        entityType: 'unit',
        entityId: unitId,
        metadata: { examTypeId, ...input },
      });
    });
  }

  async policy(): Promise<Policy> {
    const [row] = await this.db.select(policyColumns).from(settings);
    return toPolicy(row);
  }

  savePolicy(input: PolicyInput, actor: Actor): Promise<Policy> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(settings)
        .set({ ...input, updatedBy: actor.actorId })
        .returning(policyColumns);
      await recordAudit(tx, {
        ...actor,
        action: 'policy.updated',
        entityType: 'settings',
        entityId: 'policy',
        metadata: input,
      });
      return toPolicy(row);
    });
  }

  private isInUse(_tx: Transaction, _entity: CatalogEntity, _id: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  private capacityInUseAbove(_tx: Transaction, _unitId: string, _examTypeId: string, _capacity: number) {
    return Promise.resolve(false);
  }

  private async pageOf<Q extends PgSelect>(table: PgTable, pagination: Pagination, query: Q) {
    const items: Awaited<Q> = await query.limit(pagination.pageSize).offset(offsetOf(pagination));
    return { items, ...pagination, total: await this.db.$count(table) };
  }

  private createAudited<Row extends { id: string }>(
    entity: CatalogEntity,
    actor: Actor,
    insert: (tx: Transaction) => Promise<Row[]>,
  ): Promise<Row> {
    return this.db.transaction(async (tx) => {
      const [row] = await insert(tx);
      if (!row) throw new Error(`Insert into ${entity} returned no row`);
      await recordAudit(tx, { ...actor, action: `${entity}.created`, entityType: entity, entityId: row.id });
      return row;
    });
  }

  private updateAudited<Row>(
    entity: CatalogEntity,
    id: string,
    changes: Record<string, unknown>,
    actor: Actor,
    update: (tx: Transaction) => Promise<Row[]>,
  ): Promise<Row | undefined> {
    return this.db.transaction(async (tx) => {
      if (!(await lockRow(tx, entity, id))) return undefined;
      if (changes.isActive === false && (await this.isInUse(tx, entity, id))) throw new InUseError();
      const [row] = await update(tx);
      if (row) await recordAudit(tx, { ...actor, ...changeEntry(entity, id, changes) });
      return row;
    });
  }

  private async withHours(rows: UnitRow[], db: Pick<Database, 'select'> = this.db): Promise<Unit[]> {
    if (rows.length === 0) return [];
    const hours = await db
      .select({
        unitId: unitHours.unitId,
        weekday: unitHours.weekday,
        openMin: unitHours.openMin,
        closeMin: unitHours.closeMin,
      })
      .from(unitHours)
      .where(
        inArray(
          unitHours.unitId,
          rows.map((row) => row.id),
        ),
      );
    return rows.map((row) => ({
      ...row,
      hours: sortHours(hours.filter((hour) => hour.unitId === row.id).map(({ unitId: _unitId, ...hour }) => hour)),
    }));
  }
}

async function lockRow(tx: Transaction, entity: CatalogEntity, id: string): Promise<boolean> {
  const { table, id: idColumn } = lockable[entity];
  const rows = await tx.select({ id: idColumn }).from(table).where(eq(idColumn, id)).for('no key update');
  return rows.length > 0;
}

async function replaceHours(tx: Transaction, unitId: string, hours: HourRow[]): Promise<void> {
  await tx.delete(unitHours).where(eq(unitHours.unitId, unitId));
  if (hours.length > 0) await tx.insert(unitHours).values(hours.map((hour) => ({ ...hour, unitId })));
}

function toPolicy(row: PolicyRow | undefined): Policy {
  if (!row) throw new Error('Settings row is missing');
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function sortHours(hours: HourRow[]): HourRow[] {
  return [...hours].sort((a, b) => a.weekday - b.weekday);
}

function changeEntry(entityType: CatalogEntity, entityId: string, changes: Record<string, unknown>) {
  const action = changes.isActive === false ? 'deactivated' : changes.isActive === true ? 'activated' : 'updated';
  return { action: `${entityType}.${action}`, entityType, entityId, metadata: { fields: Object.keys(changes) } };
}
