import './zod-extend.js';
import { z } from 'zod';
import type { FieldConflict } from '../lib/app-error.js';
import { registry } from './registry.js';

export const errorResponseSchema = registry.register(
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

export interface ErrorExample {
  message: string;
  code: string;
  fields?: Record<string, string>;
}

export function errorResponse(description: string, example: ErrorExample) {
  return {
    description,
    content: { 'application/json': { schema: errorResponseSchema, example } },
  };
}

export const internalErrorResponse = errorResponse('Erro inesperado no servidor (`INTERNAL_ERROR`).', {
  message: 'Erro interno do servidor.',
  code: 'INTERNAL_ERROR',
});

export const validationErrorResponse = errorResponse('Dados inválidos (`VALIDATION_ERROR` ou `INVALID_JSON`).', {
  message: 'Dados inválidos.',
  code: 'VALIDATION_ERROR',
  fields: { email: 'Informe um e-mail válido.' },
});

export const unauthenticatedResponse = errorResponse('Sem sessão ou com sessão expirada (`UNAUTHENTICATED`).', {
  message: 'Sua sessão expirou. Entre novamente.',
  code: 'UNAUTHENTICATED',
});

export const forbiddenResponse = errorResponse('A conta não tem o perfil exigido (`FORBIDDEN`).', {
  message: 'Você não tem acesso a esta área.',
  code: 'FORBIDDEN',
});

export const tooManyRequestsResponse = errorResponse(
  'Limite de tentativas atingido (`TOO_MANY_REQUESTS`). O cabeçalho `RateLimit` diz quando tentar de novo.',
  {
    message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    code: 'TOO_MANY_REQUESTS',
  },
);

export const serverBusyResponse = errorResponse(
  'Servidor ocupado conferindo outras senhas (`SERVER_BUSY`). Tente de novo em instantes.',
  { message: 'O servidor está ocupado. Tente de novo em instantes.', code: 'SERVER_BUSY' },
);

export function jsonResponse(description: string, schema: z.ZodType) {
  return { description, content: { 'application/json': { schema } } };
}

export function jsonBody(schema: z.ZodType) {
  return { content: { 'application/json': { schema } } };
}

export function conflictResponse(...conflicts: [FieldConflict, ...FieldConflict[]]) {
  const [example] = conflicts;
  const codes = [...new Set(conflicts.map(({ code }) => `\`${code}\``))].join(', ');
  return errorResponse(`Conflito com o estado atual (${codes}).`, {
    message: example.message,
    code: example.code,
    fields: { [example.field]: example.message },
  });
}

export function notFoundResponse(message: string) {
  return errorResponse('Registro inexistente (`NOT_FOUND`).', { message, code: 'NOT_FOUND' });
}
