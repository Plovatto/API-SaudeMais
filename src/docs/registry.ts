import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import './zod-extend.js';

export const registry = new OpenAPIRegistry();

export const sessionAuth = registry.registerComponent('securitySchemes', 'sessionAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Token de sessão obtido no login, enviado como "Authorization: Bearer <token>".',
});

export const sessionSecurity = { security: [{ [sessionAuth.name]: [] }] };

const labApiKey = registry.registerComponent('securitySchemes', 'labApiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-Api-Key',
  description: 'Chave de API do laboratório, criada pelo administrador e exibida uma única vez.',
});

export const labKeySecurity = { security: [{ [labApiKey.name]: [] }] };
