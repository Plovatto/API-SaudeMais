import { z } from 'zod';

export const uuidParam = z.uuid('Identificador inválido.');

export const idParams = z.strictObject({ id: uuidParam });
