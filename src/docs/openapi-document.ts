import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export function generateOpenApiDocument(): OpenApiDocument {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Saúde+ API',
      version: '0.1.0',
      description: 'API do Saúde+, sistema de agendamento de consultas e exames.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: '/', description: 'Servidor atual' }],
  });
}
