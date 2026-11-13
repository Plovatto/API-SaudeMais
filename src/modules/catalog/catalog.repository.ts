import { and, asc, eq, exists, inArray } from 'drizzle-orm';
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

export type Actor = Omit<AuditEntry, 'action' | 'entityType' | 'entityId' | 'metadata'>;
export type CatalogEntity = 'specialty' | 'unit' | 'exam_type';

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

type UnitRow = Omit<Unit, 'hours'>;
type HourRow = Unit['hours'][number];

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
            .where(
              and(
                eq(unitExamOffers.unitId, units.id),
                eq(unitExamOffers.examTypeId, examTypeId),
                eq(unitExamOffers.isActive, true),
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

  async specialtyPage(pagination: Pagination): Promise<Page<Specialty>> {
    const items = await this.db
      .select(specialtyColumns)
      .from(specialties)
      .orderBy(asc(specialties.name))
      .limit(pagination.pageSize)
      .offset(offsetOf(pagination));
    return { items, ...pagination, total: await this.db.$count(specialties) };
  }

  async unitPage(pagination: Pagination): Promise<Page<Unit>> {
    const rows = await this.db
      .select(unitColumns)
      .from(units)
      .orderBy(asc(units.name))
      .limit(pagination.pageSize)
      .offset(offsetOf(pagination));
    return { items: await this.withHours(rows), ...pagination, total: await this.db.$count(units) };
  }

  async examTypePage(pagination: Pagination): Promise<Page<ExamType>> {
    const items = await this.db
      .select(examTypeColumns)
      .from(examTypes)
      .orderBy(asc(examTypes.name))
      .limit(pagination.pageSize)
      .offset(offsetOf(pagination));
    return { items, ...pagination, total: await this.db.$count(examTypes) };
  }

  createSpecialty(input: CreateSpecialtyInput, actor: Actor): Promise<Specialty> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(specialties).values(input).returning(specialtyColumns);
      if (!row) throw new Error('Specialty insert returned no row');
      await recordAudit(tx, { ...actor, action: 'specialty.created', entityType: 'specialty', entityId: row.id });
      return row;
    });
  }

  updateSpecialty(id: string, changes: UpdateSpecialtyInput, actor: Actor): Promise<Specialty | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(specialties).set(changes).where(eq(specialties.id, id)).returning(specialtyColumns);
      if (row) await recordAudit(tx, { ...actor, ...changeEntry('specialty', id, changes) });
      return row;
    });
  }

  createExamType(input: CreateExamTypeInput, actor: Actor): Promise<ExamType> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(examTypes).values(input).returning(examTypeColumns);
      if (!row) throw new Error('Exam type insert returned no row');
      await recordAudit(tx, { ...actor, action: 'exam_type.created', entityType: 'exam_type', entityId: row.id });
      return row;
    });
  }

  updateExamType(id: string, changes: UpdateExamTypeInput, actor: Actor): Promise<ExamType | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.update(examTypes).set(changes).where(eq(examTypes.id, id)).returning(examTypeColumns);
      if (row) await recordAudit(tx, { ...actor, ...changeEntry('exam_type', id, changes) });
      return row;
    });
  }

  createUnit({ hours, ...input }: CreateUnitInput, actor: Actor): Promise<Unit> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(units).values(input).returning(unitColumns);
      if (!row) throw new Error('Unit insert returned no row');
      if (hours.length > 0) await tx.insert(unitHours).values(hours.map((hour) => ({ ...hour, unitId: row.id })));
      await recordAudit(tx, { ...actor, action: 'unit.created', entityType: 'unit', entityId: row.id });
      return { ...row, hours: sortHours(hours) };
    });
  }

  updateUnit(id: string, { hours, ...changes }: UpdateUnitInput, actor: Actor): Promise<Unit | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] =
        Object.keys(changes).length > 0
          ? await tx.update(units).set(changes).where(eq(units.id, id)).returning(unitColumns)
          : await tx.select(unitColumns).from(units).where(eq(units.id, id)).for('no key update');
      if (!row) return undefined;
      if (hours) {
        await tx.delete(unitHours).where(eq(unitHours.unitId, id));
        if (hours.length > 0) await tx.insert(unitHours).values(hours.map((hour) => ({ ...hour, unitId: id })));
      }
      await recordAudit(tx, {
        ...actor,
        ...changeEntry('unit', id, { ...changes, ...(hours && { hours: hours.length }) }),
      });
      const [withHours] = await this.withHours([row], tx);
      return withHours;
    });
  }

  async unitExists(id: string): Promise<boolean> {
    return (await this.db.$count(units, eq(units.id, id))) > 0;
  }

  async examTypeExists(id: string): Promise<boolean> {
    return (await this.db.$count(examTypes, eq(examTypes.id, id))) > 0;
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
    if (!row) throw new Error('Settings row is missing');
    return { ...row, updatedAt: row.updatedAt.toISOString() };
  }

  savePolicy(input: PolicyInput, actor: Actor): Promise<Policy> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(settings)
        .set({ ...input, updatedBy: actor.actorId })
        .returning(policyColumns);
      if (!row) throw new Error('Settings row is missing');
      await recordAudit(tx, {
        ...actor,
        action: 'policy.updated',
        entityType: 'settings',
        entityId: 'policy',
        metadata: input,
      });
      return { ...row, updatedAt: row.updatedAt.toISOString() };
    });
  }

  isInUse(_entity: CatalogEntity, _id: string): Promise<boolean> {
    return Promise.resolve(false);
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

function sortHours(hours: HourRow[]): HourRow[] {
  return [...hours].sort((a, b) => a.weekday - b.weekday);
}

function changeEntry(entityType: CatalogEntity, entityId: string, changes: Record<string, unknown>) {
  const action = changes.isActive === false ? 'deactivated' : changes.isActive === true ? 'activated' : 'updated';
  return { action: `${entityType}.${action}`, entityType, entityId, metadata: { fields: Object.keys(changes) } };
}
