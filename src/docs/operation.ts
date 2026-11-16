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

interface Success {
  status: 200 | 201 | 202 | 204;
  description: string;
  schema?: z.ZodType;
}

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
  success: Success | Success[];
  errors?: Partial<Record<401 | 403 | 404 | 409 | 422 | 503, ResponseConfig>>;
  auth?: typeof sessionSecurity;
}

export function documentOperation({
  success,
  errors,
  tag,
  body,
  query,
  params,
  auth = sessionSecurity,
  ...operation
}: OperationDoc): void {
  const responses: Record<number, ResponseConfig> = {
    ...Object.fromEntries(
      [success]
        .flat()
        .map(({ status, description, schema }) => [
          status,
          schema ? jsonResponse(description, schema) : { description },
        ]),
    ),
    401: unauthenticatedResponse,
    429: tooManyRequestsResponse,
    500: internalErrorResponse,
    ...errors,
  };
  if (body ?? query ?? params) responses[400] = validationErrorResponse;
  registry.registerPath({
    ...operation,
    tags: [tag],
    ...auth,
    request: { ...(body && { body: jsonBody(body) }), ...(query && { query }), ...(params && { params }) },
    responses,
  });
}
