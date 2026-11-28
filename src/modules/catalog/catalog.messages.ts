import { MAX_ACTIVE_CATALOG_ITEMS } from '../../database/schema/catalog.js';

export type CatalogEntity = 'specialty' | 'unit' | 'exam_type';

export const notFoundMessages: Record<CatalogEntity, string> = {
  specialty: 'Especialidade não encontrada.',
  unit: 'Unidade não encontrada.',
  exam_type: 'Tipo de exame não encontrado.',
};

import type { FieldConflict as Conflict } from '../../lib/app-error.js';

export type { Conflict };

export const uniqueConflicts = {
  specialties_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe uma especialidade com esse nome.' },
  units_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe uma unidade com esse nome.' },
  exam_types_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe um tipo de exame com esse nome.' },
  exam_types_code_key: { code: 'CODE_TAKEN', field: 'code', message: 'Já existe um tipo de exame com esse código.' },
} satisfies Record<string, Conflict>;

export const CATALOG_LIMIT_CODE = 'CATALOG_LIMIT_REACHED';

export const catalogLimitMessages: Record<CatalogEntity, string> = {
  specialty: `O limite de ${MAX_ACTIVE_CATALOG_ITEMS} especialidades ativas foi atingido; desative uma antes de continuar.`,
  unit: `O limite de ${MAX_ACTIVE_CATALOG_ITEMS} unidades ativas foi atingido; desative uma antes de continuar.`,
  exam_type: `O limite de ${MAX_ACTIVE_CATALOG_ITEMS} tipos de exame ativos foi atingido; desative um antes de continuar.`,
};

export const examTypeInactive: Conflict = {
  code: 'EXAM_TYPE_INACTIVE',
  field: 'isActive',
  message: 'Este tipo de exame está inativo; ative-o antes de oferecê-lo.',
};

export const councilInUse: Conflict = {
  code: 'COUNCIL_IN_USE',
  field: 'council',
  message: 'Há médicos nesta especialidade; o conselho não pode ser alterado.',
};

export const inUse: Conflict = {
  code: 'IN_USE',
  field: 'isActive',
  message: 'Há agendamentos futuros ligados a este cadastro; ele não pode ser desativado.',
};

export const capacityInUse: Conflict = {
  code: 'IN_USE',
  field: 'capacityPerSlot',
  message: 'Há exames marcados ou em andamento acima desta capacidade; ela não pode ser reduzida.',
};
