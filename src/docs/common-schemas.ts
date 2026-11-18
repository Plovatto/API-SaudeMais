import './zod-extend.js';
import { z } from 'zod';
import { INVALID_DATA_MESSAGE, type FieldConflict } from '../lib/app-error.js';
import { FORBIDDEN_MESSAGE, UNAUTHENTICATED_MESSAGE } from '../middleware/auth.js';
import { INTERNAL_ERROR_MESSAGE } from '../middleware/error-handler.js';
import { TOO_MANY_REQUESTS_MESSAGE } from '../middleware/rate-limit.js';
import { SERVER_BUSY_MESSAGE } from '../modules/users/user.password.js';
import { registry } from './registry.js';

const errorResponseSchema = registry.register(
  'ErrorResponse',
  z
    .object({
      message: z.string().openapi({
        description: 'Texto em português, pronto para exibir.',
        example: 'Dados inválidos.',
      }),
      code: z.string().openapi({
        description: 'Código estável do erro.',
        example: 'VALIDATION_ERROR',
      }),
      fields: z
        .record(z.string(), z.string())
        .optional()
        .openapi({
          description: 'Uma mensagem por campo inválido.',
          example: { email: 'E-mail inválido.' },
        }),
    })
    .openapi({ description: 'Corpo de toda resposta de erro.' }),
);

interface ErrorExample {
  message: string;
  code: string;
  fields?: Record<string, string>;
}

export function fieldErrorExample({ code, field, message }: FieldConflict): ErrorExample {
  return { message, code, fields: { [field]: message } };
}

export function errorResponse(description: string, example: ErrorExample) {
  return {
    description,
    content: { 'application/json': { schema: errorResponseSchema, example } },
  };
}

export const internalErrorResponse = errorResponse('Erro inesperado no servidor (`INTERNAL_ERROR`).', {
  message: INTERNAL_ERROR_MESSAGE,
  code: 'INTERNAL_ERROR',
});

export const validationErrorResponse = errorResponse('Dados inválidos (`VALIDATION_ERROR` ou `INVALID_JSON`).', {
  message: INVALID_DATA_MESSAGE,
  code: 'VALIDATION_ERROR',
  fields: { email: 'Informe um e-mail válido.' },
});

export const unauthenticatedResponse = errorResponse('Sem sessão ou com sessão expirada (`UNAUTHENTICATED`).', {
  message: UNAUTHENTICATED_MESSAGE,
  code: 'UNAUTHENTICATED',
});

export const forbiddenResponse = errorResponse('A conta não tem o perfil exigido (`FORBIDDEN`).', {
  message: FORBIDDEN_MESSAGE,
  code: 'FORBIDDEN',
});

export const tooManyRequestsResponse = errorResponse(
  'Limite de tentativas atingido (`TOO_MANY_REQUESTS`). O cabeçalho `RateLimit` diz quando tentar de novo.',
  {
    message: TOO_MANY_REQUESTS_MESSAGE,
    code: 'TOO_MANY_REQUESTS',
  },
);

export const serverBusyResponse = errorResponse(
  'Servidor ocupado conferindo outras senhas (`SERVER_BUSY`). Tente de novo em instantes.',
  { message: SERVER_BUSY_MESSAGE, code: 'SERVER_BUSY' },
);

export function jsonResponse(description: string, schema: z.ZodType) {
  return { description, content: { 'application/json': { schema } } };
}

export function jsonBody(schema: z.ZodType) {
  return { content: { 'application/json': { schema } } };
}

export function conflictResponse(...conflicts: [FieldConflict, ...FieldConflict[]]) {
  const codes = [...new Set(conflicts.map(({ code }) => `\`${code}\``))].join(', ');
  return errorResponse(`Conflito com o estado atual (${codes}).`, fieldErrorExample(conflicts[0]));
}

export function notFoundResponse(message: string) {
  return errorResponse('Registro inexistente (`NOT_FOUND`).', { message, code: 'NOT_FOUND' });
}

export function nullableRef<T extends z.ZodType>(schema: T) {
  return z.union([schema, z.null()]);
}

export const countSchema = (description: string, example: number) =>
  z.int().nonnegative().openapi({ description, example });

export interface FileDownload {
  mediaTypes: [string, ...string[]];
  disposition: string;
  example: string;
}

export function fileResponse(description: string, { mediaTypes, disposition, example }: FileDownload) {
  return {
    description,
    headers: { 'Content-Disposition': { description: disposition, schema: { type: 'string' as const, example } } },
    content: Object.fromEntries(
      mediaTypes.map((mediaType) => [mediaType, { schema: { type: 'string' as const, format: 'binary' } }]),
    ),
  };
}
