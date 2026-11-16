import type { ExamKind } from '../../database/schema/catalog.js';
import type { FieldConflict } from '../../lib/app-error.js';

export const clientNotFound = 'Integração não encontrada.';

export const examNotFound = 'Nenhum exame tem este código.';

export const clientConflicts = {
  integration_clients_name_key: {
    code: 'NAME_TAKEN',
    field: 'name',
    message: 'Já existe uma integração com esse nome.',
  },
} satisfies Record<string, FieldConflict>;

export const resultConflicts = {
  otherResult: {
    code: 'RESULT_EXISTS',
    field: 'externalId',
    message: 'Este exame já tem um resultado com outro externalId.',
  },
  final: {
    code: 'RESULT_FINAL',
    field: 'status',
    message: 'Este resultado já foi publicado com outro conteúdo. Para corrigi-lo, envie status amended.',
  },
  exam_results_client_external_id_key: {
    code: 'EXTERNAL_ID_TAKEN',
    field: 'externalId',
    message: 'Este externalId já foi usado no resultado de outro exame.',
  },
} satisfies Record<string, FieldConflict>;

export const notEligible: FieldConflict = {
  code: 'NOT_ELIGIBLE',
  field: 'examCode',
  message: 'Este exame foi cancelado ou ainda não aconteceu, então não recebe resultado.',
};

export const wrongFormat = {
  lab: { code: 'WRONG_RESULT_FORMAT', field: 'items', message: 'Exame laboratorial recebe itens, não laudo.' },
  imaging: { code: 'WRONG_RESULT_FORMAT', field: 'report', message: 'Exame de imagem recebe laudo, não itens.' },
} satisfies Record<ExamKind, FieldConflict>;
