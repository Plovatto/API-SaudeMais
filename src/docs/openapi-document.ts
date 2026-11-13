import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { apiDescription } from './api-description.js';
import { registry } from './registry.js';
import { tagList } from './tags.js';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export function generateOpenApiDocument(): OpenApiDocument {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Saúde+ API',
      version: '0.1.0',
      description: apiDescription,
      contact: { name: 'Plovatto', url: 'https://github.com/Plovatto' },
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [
      { url: '/', description: 'Servidor desta página' },
      { url: 'https://p01--saudemais--pgj2h2jjxzb4.code.run', description: 'Produção' },
      { url: 'http://localhost:3001', description: 'Desenvolvimento local' },
    ],
    tags: [...tagList],
    externalDocs: { description: 'Código-fonte e instruções', url: 'https://github.com/Plovatto/API-SaudeMais' },
  });
}
