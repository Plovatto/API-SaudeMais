export type CatalogEntity = 'specialty' | 'unit' | 'exam_type';

export const notFoundMessages: Record<CatalogEntity, string> = {
  specialty: 'Especialidade não encontrada.',
  unit: 'Unidade não encontrada.',
  exam_type: 'Tipo de exame não encontrado.',
};

export interface Conflict {
  code: string;
  field: string;
  message: string;
}

export const uniqueConflicts = {
  specialties_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe uma especialidade com esse nome.' },
  units_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe uma unidade com esse nome.' },
  exam_types_name_key: { code: 'NAME_TAKEN', field: 'name', message: 'Já existe um tipo de exame com esse nome.' },
  exam_types_code_key: { code: 'CODE_TAKEN', field: 'code', message: 'Já existe um tipo de exame com esse código.' },
} satisfies Record<string, Conflict>;

export type UniqueConstraint = keyof typeof uniqueConflicts;

export const examTypeInactive: Conflict = {
  code: 'EXAM_TYPE_INACTIVE',
  field: 'isActive',
  message: 'Este tipo de exame está inativo; ative-o antes de oferecê-lo.',
};

export const inUse: Conflict = {
  code: 'IN_USE',
  field: 'isActive',
  message: 'Há agendamentos futuros ligados a este cadastro; ele não pode ser desativado.',
};
