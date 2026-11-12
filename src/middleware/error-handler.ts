import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { AppError, type FieldErrors } from '../lib/app-error.js';

interface ErrorBody {
  message: string;
  code: string;
  fields?: FieldErrors;
}

interface HttpClientError {
  status: number;
  type?: unknown;
}

/**
 * Client errors raised by Express itself: body-parser (http-errors with `expose: true`) and the
 * router when a URL parameter cannot be decoded (URIError with status 400).
 * Errors from third-party SDKs that merely have a `status` are not trusted and become 500.
 */
function asHttpClientError(err: unknown): HttpClientError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  if (typeof status !== 'number' || status < 400 || status > 499) return undefined;
  if (candidate.expose === true || err instanceof URIError) return { status, type: candidate.type };
  return undefined;
}

function zodFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    fields[key] ??= issue.message;
  }
  return fields;
}

function toResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    const body: ErrorBody = { message: err.message, code: err.code };
    if (err.fields && Object.keys(err.fields).length > 0) body.fields = err.fields;
    return { status: err.status, body };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: { message: 'Dados inválidos.', code: 'VALIDATION_ERROR', fields: zodFieldErrors(err) },
    };
  }

  const clientError = asHttpClientError(err);
  if (clientError) {
    if (clientError.type === 'entity.parse.failed') {
      return { status: 400, body: { message: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' } };
    }
    if (clientError.type === 'entity.too.large') {
      return { status: 413, body: { message: 'O corpo da requisição é grande demais.', code: 'PAYLOAD_TOO_LARGE' } };
    }
    return { status: clientError.status, body: { message: 'Requisição inválida.', code: 'BAD_REQUEST' } };
  }

  return { status: 500, body: { message: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' } };
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.'));
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, body } = toResponse(err);
  if (status >= 500) {
    // req.log ties the entry to the request id when pino-http is mounted.
    (req.log ?? logger).error({ err }, 'Unhandled error');
  }
  res.status(status).json(body);
}
