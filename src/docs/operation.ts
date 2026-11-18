import type { ResponseConfig } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import {
  fileResponse,
  internalErrorResponse,
  jsonBody,
  jsonResponse,
  tooManyRequestsResponse,
  unauthenticatedResponse,
  validationErrorResponse,
  type FileDownload,
} from './common-schemas.js';
import { registry, sessionSecurity, type OperationSecurity } from './registry.js';

interface Success {
  status: 200 | 201 | 202 | 204;
  description: string;
  schema?: z.ZodType;
  file?: FileDownload;
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
  errors?: Partial<Record<400 | 401 | 403 | 404 | 409 | 422 | 503, ResponseConfig>>;
  auth?: OperationSecurity;
  rateLimited?: boolean;
}

export function documentOperation({
  success,
  errors,
  tag,
  body,
  query,
  params,
  auth = sessionSecurity,
  rateLimited = true,
  ...operation
}: OperationDoc): void {
  const responses: Record<number, ResponseConfig> = {
    ...Object.fromEntries(
      [success]
        .flat()
        .map(({ status, description, schema, file }) => [
          status,
          file ? fileResponse(description, file) : schema ? jsonResponse(description, schema) : { description },
        ]),
    ),
    ...(auth.security.length > 0 && { 401: unauthenticatedResponse }),
    ...(rateLimited && { 429: tooManyRequestsResponse }),
    500: internalErrorResponse,
    ...(Boolean(body ?? query ?? params) && { 400: validationErrorResponse }),
    ...errors,
  };
  registry.registerPath({
    ...operation,
    tags: [tag],
    ...auth,
    request: { ...(body && { body: jsonBody(body) }), ...(query && { query }), ...(params && { params }) },
    responses,
  });
}
