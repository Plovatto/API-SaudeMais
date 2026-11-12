import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/lib/app-error.js';
import { errorHandler, notFoundHandler } from '@/middleware/error-handler.js';

function buildAppThatThrows(error: unknown) {
  const app = express();
  app.get('/sync', () => {
    throw error;
  });
  app.get('/async', () => Promise.reject(error instanceof Error ? error : new Error(String(error))));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('turns an AppError into its status and body', async () => {
    const app = buildAppThatThrows(new AppError(409, 'EMAIL_TAKEN', 'E-mail já cadastrado.'));

    const response = await request(app).get('/sync');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ message: 'E-mail já cadastrado.', code: 'EMAIL_TAKEN' });
  });

  it('includes field errors when the AppError has them', async () => {
    const app = buildAppThatThrows(
      new AppError(422, 'OVERLAP', 'Faixas sobrepostas.', { 'ranges.1': 'Sobrepõe a faixa anterior.' }),
    );

    const response = await request(app).get('/sync');

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      message: 'Faixas sobrepostas.',
      code: 'OVERLAP',
      fields: { 'ranges.1': 'Sobrepõe a faixa anterior.' },
    });
  });

  it('handles rejected promises from async handlers', async () => {
    const app = buildAppThatThrows(new AppError(403, 'FORBIDDEN', 'Acesso negado.'));

    const response = await request(app).get('/async');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Acesso negado.', code: 'FORBIDDEN' });
  });

  it('turns a ZodError into 400 with one message per field', async () => {
    const schema = z.object({ email: z.email('E-mail inválido.'), age: z.number() });
    const result = schema.safeParse({ email: 'nope' });
    const app = buildAppThatThrows(result.error);

    const response = await request(app).get('/sync');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    const fields = (response.body as { fields: Record<string, string> }).fields;
    expect(fields.email).toBe('E-mail inválido.');
    expect(fields.age).toBeDefined();
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const app = buildAppThatThrows(new Error('connection string postgres://user:pass@host/db'));

    const response = await request(app).get('/sync');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(response.body)).not.toContain('postgres://');
  });

  it('treats thrown non-error values as 500', async () => {
    const app = buildAppThatThrows('just a string');

    const response = await request(app).get('/sync');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
