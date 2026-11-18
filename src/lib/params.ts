import '../docs/zod-extend.js';
import { z } from 'zod';

export const uuidParam = z.uuid('Identificador inválido.').openapi({ example: '0190a5d2-7c1e-7b3a-9f4d-2e8b6c1a5f30' });

export const idParams = z.strictObject({ id: uuidParam });
