import { AppError } from '../../lib/app-error.js';
import type { Pagination } from '../../lib/pagination.js';
import { uniqueConstraintOf } from '../../lib/pg-errors.js';
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
import type { Actor, CatalogEntity, CatalogRepository } from './catalog.repository.js';

const conflicts: Record<string, { code: string; field: string; message: string }> = {
  specialties_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe uma especialidade com esse nome.' },
  units_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe uma unidade com esse nome.' },
  exam_types_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe um tipo de exame com esse nome.' },
  exam_types_code_key: { code: 'CODE_TAKEN', field: 'code', message: 'Já existe um tipo de exame com esse código.' },
};

const notFoundMessages: Record<CatalogEntity, string> = {
  specialty: 'Especialidade não encontrada.',
  unit: 'Unidade não encontrada.',
  exam_type: 'Tipo de exame não encontrado.',
};

function notFound(entity: CatalogEntity): AppError {
  return new AppError(404, 'NOT_FOUND', notFoundMessages[entity]);
}

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const conflict = conflicts[uniqueConstraintOf(error) ?? ''];
    if (conflict) throw new AppError(409, conflict.code, conflict.message, { [conflict.field]: conflict.message });
    throw error;
  }
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
    await this.assertCanDeactivate('specialty', id, changes.isActive);
    return found('specialty', await translated(() => this.repository.updateSpecialty(id, changes, actor)));
  }

  createUnit(input: CreateUnitInput, actor: Actor) {
    return translated(() => this.repository.createUnit(input, actor));
  }

  async updateUnit(id: string, changes: UpdateUnitInput, actor: Actor) {
    await this.assertCanDeactivate('unit', id, changes.isActive);
    return found('unit', await translated(() => this.repository.updateUnit(id, changes, actor)));
  }

  createExamType(input: CreateExamTypeInput, actor: Actor) {
    return translated(() => this.repository.createExamType(input, actor));
  }

  async updateExamType(id: string, changes: UpdateExamTypeInput, actor: Actor) {
    await this.assertCanDeactivate('exam_type', id, changes.isActive);
    return found('exam_type', await translated(() => this.repository.updateExamType(id, changes, actor)));
  }

  async offersOf(unitId: string) {
    if (!(await this.repository.unitExists(unitId))) throw notFound('unit');
    return this.repository.offersOf(unitId);
  }

  async saveOffer(unitId: string, examTypeId: string, input: SaveOfferInput, actor: Actor) {
    if (!(await this.repository.unitExists(unitId))) throw notFound('unit');
    if (!(await this.repository.examTypeExists(examTypeId))) throw notFound('exam_type');
    await this.repository.saveOffer(unitId, examTypeId, input, actor);
    return this.repository.offersOf(unitId);
  }

  policy() {
    return this.repository.policy();
  }

  savePolicy(input: PolicyInput, actor: Actor) {
    return this.repository.savePolicy(input, actor);
  }

  private async assertCanDeactivate(entity: CatalogEntity, id: string, isActive: boolean | undefined) {
    if (isActive === false && (await this.repository.isInUse(entity, id))) {
      throw new AppError(
        409,
        'IN_USE',
        'Há agendamentos futuros ligados a este cadastro; ele não pode ser desativado.',
      );
    }
  }
}

function found<T>(entity: CatalogEntity, value: T | undefined): T {
  if (value === undefined) throw notFound(entity);
  return value;
}
