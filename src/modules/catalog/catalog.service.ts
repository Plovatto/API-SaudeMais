import { conflictError, notFound, type AppError } from '../../lib/app-error.js';
import { withConstraintConflicts } from '../../lib/constraint-conflicts.js';
import type { Pagination } from '../../lib/pagination.js';
import type {
  CreateExamTypeInput,
  CreateSpecialtyInput,
  CreateUnitInput,
  PolicyInput,
  SaveOfferInput,
  UpdateExamTypeInput,
  UpdateSpecialtyInput,
  UpdateUnitInput,
} from './catalog.model.js';
import {
  councilInUse,
  examTypeInactive,
  notFoundMessages,
  uniqueConflicts,
  type CatalogEntity,
  type Conflict,
} from './catalog.messages.js';
import { InUseError, type Actor, type CatalogRepository } from './catalog.repository.js';

function missing(entity: CatalogEntity): AppError {
  return notFound(notFoundMessages[entity]);
}

const constraintConflicts: Record<string, Conflict> = {
  ...uniqueConflicts,
  doctor_profiles_specialty_council_fkey: councilInUse,
};

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await withConstraintConflicts(write, constraintConflicts);
  } catch (error) {
    if (error instanceof InUseError) throw conflictError(error.conflict);
    throw error;
  }
}

function found<T>(entity: CatalogEntity, value: T | undefined): T {
  if (value === undefined) throw missing(entity);
  return value;
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  activeSpecialties() {
    return this.repository.activeSpecialties();
  }

  activeExamTypes() {
    return this.repository.activeExamTypes();
  }

  activeUnits(examTypeId: string | undefined) {
    return this.repository.activeUnits(examTypeId);
  }

  specialtyPage(pagination: Pagination) {
    return this.repository.specialtyPage(pagination);
  }

  unitPage(pagination: Pagination) {
    return this.repository.unitPage(pagination);
  }

  examTypePage(pagination: Pagination) {
    return this.repository.examTypePage(pagination);
  }

  createSpecialty(input: CreateSpecialtyInput, actor: Actor) {
    return translated(() => this.repository.createSpecialty(input, actor));
  }

  async updateSpecialty(id: string, changes: UpdateSpecialtyInput, actor: Actor) {
    return found('specialty', await translated(() => this.repository.updateSpecialty(id, changes, actor)));
  }

  createUnit(input: CreateUnitInput, actor: Actor) {
    return translated(() => this.repository.createUnit(input, actor));
  }

  async updateUnit(id: string, changes: UpdateUnitInput, actor: Actor) {
    return found('unit', await translated(() => this.repository.updateUnit(id, changes, actor)));
  }

  createExamType(input: CreateExamTypeInput, actor: Actor) {
    return translated(() => this.repository.createExamType(input, actor));
  }

  async updateExamType(id: string, changes: UpdateExamTypeInput, actor: Actor) {
    return found('exam_type', await translated(() => this.repository.updateExamType(id, changes, actor)));
  }

  async offersOf(unitId: string) {
    if (!(await this.repository.unitExists(unitId))) throw missing('unit');
    return this.repository.offersOf(unitId);
  }

  async saveOffer(unitId: string, examTypeId: string, input: SaveOfferInput, actor: Actor) {
    if (!(await this.repository.unitExists(unitId))) throw missing('unit');
    const status = await this.repository.examTypeStatus(examTypeId);
    if (status === 'missing') throw missing('exam_type');
    if (status === 'inactive' && input.isActive) throw conflictError(examTypeInactive);
    await translated(() => this.repository.saveOffer(unitId, examTypeId, input, actor));
    return this.repository.offersOf(unitId);
  }

  policy() {
    return this.repository.policy();
  }

  savePolicy(input: PolicyInput, actor: Actor) {
    return this.repository.savePolicy(input, actor);
  }
}
