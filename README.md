# Saúde+ API

[![CI](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml/badge.svg)](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Plovatto/API-SaudeMais/badge)](https://scorecard.dev/viewer/?uri=github.com/Plovatto/API-SaudeMais)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador. Desenvolvida com Node.js, TypeScript e Express.

> Projeto em desenvolvimento. O andamento está no [quadro do projeto](https://github.com/users/Plovatto/projects/2).

**Front-end:** [Plovatto/SaudeMais](https://github.com/Plovatto/SaudeMais)

## Funcionalidades

- Banco PostgreSQL com migrations em SQL aplicadas ao iniciar
- Configuração centralizada e validada por variáveis de ambiente
- Respostas de erro padronizadas no formato `{ message, code, fields? }`
- Cabeçalhos de segurança com Helmet e CORS restrito à origem do front
- Logging estruturado sem query string, cabeçalhos ou corpo das requisições, e com dados sensíveis ocultados
- Testes automatizados com Vitest, em PostgreSQL em memória e em PostgreSQL real

## Tecnologias

- [Node.js](https://nodejs.org/) 22.13+ (24 LTS recomendado)
- [TypeScript](https://www.typescriptlang.org/)
- [Express](https://expressjs.com/)
- [PostgreSQL](https://www.postgresql.org/) com [Drizzle ORM](https://orm.drizzle.team/)
- [Zod](https://zod.dev/) - validação de requisições e variáveis de ambiente
- [Helmet](https://helmetjs.github.io/) e [cors](https://github.com/expressjs/cors) - segurança HTTP
- [Pino](https://getpino.io/) - logging estruturado
- [Vitest](https://vitest.dev/), [Supertest](https://github.com/ladjs/supertest) e [PGlite](https://pglite.dev/) - testes automatizados
- ESLint - análise e padronização do código

## Como Executar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 22.13 ou superior
- npm
- [PostgreSQL](https://www.postgresql.org/) 16 ou superior, com as extensões `citext` e `btree_gist` disponíveis

### Instalação

Clone o repositório:

```bash
git clone https://github.com/Plovatto/API-SaudeMais.git
```

Acesse a pasta do projeto:

```bash
cd API-SaudeMais
```

Instale as dependências:

```bash
npm install
```

Crie o arquivo de variáveis de ambiente:

```bash
cp .env.example .env
```

Execute em modo de desenvolvimento:

```bash
npm run dev
```

A API estará disponível em:

```text
http://localhost:3001
```

## Variáveis de Ambiente

As variáveis são definidas no arquivo `.env`, que não deve ser versionado. Utilize `.env.example` como referência:

```env
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
TRUST_PROXY_HOPS=0
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgres://postgres:postgres@localhost:5432/saudemais
```

`NODE_ENV` vale `production` quando não é definida; use `development` localmente, como no `.env.example`.

`CORS_ORIGIN` é a origem do front (esquema, domínio e porta, sem caminho) e é obrigatória em produção. Variáveis vazias são tratadas como não definidas.

`DATABASE_URL` é a conexão direta com o PostgreSQL (sem pooler). As migrations pendentes são aplicadas quando a API inicia.

`TRUST_PROXY_HOPS` é o número de proxies reversos na frente da API. Com o valor certo, os limites de requisição usam o IP de cada usuário em vez do IP do proxy. Mantenha `0` quando a API recebe as conexões diretamente.

## Scripts

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia em modo de desenvolvimento, recarregando a cada alteração |
| `npm run build` | Compila para `dist/` |
| `npm start` | Executa a versão compilada |
| `npm run typecheck` | Verifica os tipos |
| `npm run lint` | Analisa o código |
| `npm test` | Roda os testes |
| `npm run test:coverage` | Roda os testes com relatório de cobertura |
| `npm run test:pg` | Roda a suíte que exige um PostgreSQL real (`TEST_DATABASE_URL`) |
| `npm run db:generate` | Gera uma migration a partir do schema |

## Banco de Dados

O schema fica em `src/database/schema` e as migrations, em `drizzle/`, como arquivos SQL versionados.

Para criar uma migration a partir de mudanças no schema:

```bash
npm run db:generate
```

Extensões, exclusion constraints e índices parciais são escritos à mão em uma migration vazia:

```bash
npx drizzle-kit generate --custom --name=nome_da_migration
```

Os testes de `npm test` usam um PostgreSQL em memória (PGlite) com as mesmas migrations. O que depende de travas e concorrência reais fica em `test-pg/` e roda com `npm run test:pg`, apontando `TEST_DATABASE_URL` para um banco descartável: a suíte apaga os schemas `public` e `drizzle` desse banco.

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Verifica se o servidor está no ar |

## Contribuindo

Veja o [guia de contribuição](CONTRIBUTING.md) e a [política de segurança](SECURITY.md).

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
