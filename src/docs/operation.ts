import type { ResponseConfig } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  internalErrorResponse,
  jsonBody,
  jsonResponse,
  tooManyRequestsResponse,
  unauthenticatedResponse,
  validationErrorResponse,
} from './common-schemas.js';
import { registry, sessionSecurity } from './registry.js';

export interface OperationDoc {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  body?: z.ZodType;
  query?: z.ZodObject;
  params?: z.ZodObject;
  success: { status: 200 | 201 | 202 | 204; description: string; schema?: z.ZodType };
  errors?: Partial<Record<403 | 404 | 409 | 422 | 503, ResponseConfig>>;
}

export function documentOperation({ success, errors, tag, body, query, params, ...operation }: OperationDoc): void {
  const responses: Record<number, ResponseConfig> = {
    [success.status]: success.schema
      ? jsonResponse(success.description, success.schema)
      : { description: success.description },
    401: unauthenticatedResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
    ...errors,
  };
  if (body ?? query ?? params) responses[400] = validationErrorResponse;
  registry.registerPath({
    ...operation,
    tags: [tag],
    ...sessionSecurity,
    request: { ...(body && { body: jsonBody(body) }), ...(query && { query }), ...(params && { params }) },
    responses,
  });
}
