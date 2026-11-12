import '@/lib/zod-locale.js';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { logger } from '@/config/logger.js';
import { AppError } from '@/lib/app-error.js';
import { errorHandler, notFoundHandler } from '@/middleware/error-handler.js';

function buildAppThatThrows(error: unknown) {
  const app = express();
  app.get('/sync', () => {
    throw error;
  });
  app.get('/async', () => Promise.reject(error instanceof Error ? error : new Error(String(error))));
  app.get('/users/:id', (req, res) => {
    res.json({ id: req.params.id });
  });
  app.get('/partial', (_req, res) => {
    res.write('partial');
    throw new Error('after headers');
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('omits empty field errors', async () => {
    const app = buildAppThatThrows(new AppError(422, 'RULE', 'Regra violada.', {}));

    const response = await request(app).get('/sync');

    expect(response.body).toEqual({ message: 'Regra violada.', code: 'RULE' });
  });

  it('handles rejected promises from async handlers', async () => {
    const app = buildAppThatThrows(new AppError(403, 'FORBIDDEN', 'Acesso negado.'));

    const response = await request(app).get('/async');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Acesso negado.', code: 'FORBIDDEN' });
  });

  it('turns a ZodError into 400 with one Portuguese message per field', async () => {
    const schema = z.object({ email: z.email('E-mail inválido.'), age: z.number() });
    const result = schema.safeParse({ email: 'nope' });
    const app = buildAppThatThrows(result.error);

    const response = await request(app).get('/sync');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Dados inválidos.',
      code: 'VALIDATION_ERROR',
      fields: { email: 'E-mail inválido.', age: 'Entrada inválida: esperava um número, recebeu um valor "undefined"' },
    });
  });

  it('keeps the first message per field, joins nested paths and uses _root for the whole value', async () => {
    const root = z.string().min(8, 'curta').regex(/\d/, 'sem dígito').safeParse('abc');
    const nested = z.object({ items: z.array(z.object({ name: z.string().min(1, 'vazio') })) }).safeParse({
      items: [{ name: 'ok' }, { name: '' }],
    });

    const rootResponse = await request(buildAppThatThrows(root.error)).get('/sync');
    const nestedResponse = await request(buildAppThatThrows(nested.error)).get('/sync');

    expect((rootResponse.body as { fields: unknown }).fields).toEqual({ _root: 'curta' });
    expect((nestedResponse.body as { fields: unknown }).fields).toEqual({ 'items.1.name': 'vazio' });
  });

  it('hides unexpected errors behind a generic 500 and logs the original error', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = buildAppThatThrows(new Error('connection string postgres://user:pass@host/db'));

    const response = await request(app).get('/sync');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' });
    expect(spy).toHaveBeenCalledWith(
      { err: expect.objectContaining({ message: expect.stringContaining('postgres://') as unknown }) as unknown },
      'Unhandled error',
    );
  });

  it('logs AppErrors with a 5xx status but not 4xx ones', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await request(buildAppThatThrows(new AppError(409, 'CONFLICT', 'Conflito.'))).get('/sync');
    expect(spy).not.toHaveBeenCalled();

    const response = await request(buildAppThatThrows(new AppError(503, 'UNAVAILABLE', 'Indisponível.'))).get('/sync');
    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('treats thrown non-error values as 500', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const app = buildAppThatThrows('just a string');

    const response = await request(app).get('/sync');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' });
  });

  it('does not trust the status of errors from other libraries', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const sdkError = Object.assign(new Error('upstream unauthorized'), { status: 401, type: 'sdk.auth' });

    const response = await request(buildAppThatThrows(sdkError)).get('/sync');

    expect(response.status).toBe(500);
  });

  it('does not trust a non-integer status even when marked as exposable', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const odd = Object.assign(new Error('odd'), { status: 404.5, expose: true });

    const response = await request(buildAppThatThrows(odd)).get('/sync');

    expect(response.status).toBe(500);
  });

  it('answers a URL parameter that cannot be decoded with 400', async () => {
    const response = await request(buildAppThatThrows(null)).get('/users/%E0%A4%A');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Requisição inválida.', code: 'BAD_REQUEST' });
  });

  it('hands errors after headers were sent to Express, which closes the connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await expect(request(buildAppThatThrows(null)).get('/partial')).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AppError', () => {
  it('rejects statuses that are not client or server errors', () => {
    expect(() => new AppError(200, 'OK', 'ok')).toThrow(RangeError);
    expect(() => new AppError(999, 'X', 'x')).toThrow(RangeError);
  });
});
