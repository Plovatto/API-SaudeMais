import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import './zod-extend.js';

export const registry = new OpenAPIRegistry();

export const sessionAuth = registry.registerComponent('securitySchemes', 'sessionAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Token de sessão obtido no login, enviado como "Authorization: Bearer <token>".',
});
