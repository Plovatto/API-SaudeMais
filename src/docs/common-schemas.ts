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
