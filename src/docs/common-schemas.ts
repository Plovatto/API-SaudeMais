import './zod-extend.js';
import { z } from 'zod';
import { registry } from './registry.js';

export const errorResponseSchema = registry.register(
  'ErrorResponse',
  z
    .object({
      message: z.string().openapi({ description: 'Texto em português, pronto para exibir.', example: 'Dados inválidos.' }),
      code: z.string().openapi({ description: 'Código estável do erro.', example: 'VALIDATION_ERROR' }),
      fields: z
        .record(z.string(), z.string())
        .optional()
        .openapi({ description: 'Uma mensagem por campo inválido.', example: { email: 'E-mail inválido.' } }),
    })
    .openapi({ description: 'Corpo de toda resposta de erro.' }),
);

export const internalErrorResponse = {
  description: 'Erro inesperado no servidor (`INTERNAL_ERROR`).',
  content: {
    'application/json': {
      schema: errorResponseSchema,
      example: { message: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' },
    },
  },
};
