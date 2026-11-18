import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import './zod-extend.js';

export const registry = new OpenAPIRegistry();

export const sessionAuth = registry.registerComponent('securitySchemes', 'sessionAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Token de sessão obtido no login, enviado como "Authorization: Bearer <token>".',
});

export interface OperationSecurity {
  security: Record<string, string[]>[];
}

export const publicSecurity: OperationSecurity = { security: [] };

export const sessionSecurity: OperationSecurity = { security: [{ [sessionAuth.name]: [] }] };

const labApiKey = registry.registerComponent('securitySchemes', 'labApiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Api-Key',
  description: 'Chave de API do laboratório, criada pelo administrador e exibida uma única vez.',
});

export const labKeySecurity: OperationSecurity = { security: [{ [labApiKey.name]: [] }] };
