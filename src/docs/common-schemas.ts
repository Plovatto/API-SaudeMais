import './zod-extend.js';
import { z } from 'zod';
import { registry } from './registry.js';

export const errorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    message: z.string().openapi({ example: 'Dados inválidos.' }),
    code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
    fields: z.record(z.string(), z.string()).optional().openapi({ example: { email: 'E-mail inválido.' } }),
  }),
);

export function errorResponse(description: string) {
  return { description, content: { 'application/json': { schema: errorResponseSchema } } };
}

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().min(0),
  });
}
