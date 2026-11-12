import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { AppError, type FieldErrors } from '../lib/app-error.js';

interface ErrorBody {
  message: string;
  code: string;
  fields?: FieldErrors;
}

// Errors raised by express.json() carry an HTTP status and a `type`.
interface BodyParserError {
  status: number;
  type: string;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Partial<BodyParserError>).type === 'string' &&
    typeof (err as Partial<BodyParserError>).status === 'number'
  );
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
    if (err.fields) body.fields = err.fields;
    return { status: err.status, body };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: { message: 'Dados inválidos.', code: 'VALIDATION_ERROR', fields: zodFieldErrors(err) },
    };
  }

  if (isBodyParserError(err)) {
    if (err.type === 'entity.parse.failed') {
      return { status: 400, body: { message: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' } };
    }
    if (err.type === 'entity.too.large') {
      return { status: 413, body: { message: 'O corpo da requisição é grande demais.', code: 'PAYLOAD_TOO_LARGE' } };
    }
    if (err.status >= 400 && err.status < 500) {
      return { status: err.status, body: { message: 'Requisição inválida.', code: 'BAD_REQUEST' } };
    }
  }

  return { status: 500, body: { message: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' } };
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Rota não encontrada: ${req.method} ${req.path}`));
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, body } = toResponse(err);
  if (status >= 500) {
    logger.error({ err }, 'Unhandled error');
  }
  res.status(status).json(body);
}
