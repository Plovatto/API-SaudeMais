# Saúde+ API

[![CI](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml/badge.svg)](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Plovatto/API-SaudeMais/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/Plovatto/API-SaudeMais/security/code-scanning)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Plovatto/API-SaudeMais/badge)](https://scorecard.dev/viewer/?uri=github.com/Plovatto/API-SaudeMais)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, um sistema de agendamento de consultas e exames para pacientes, médicos e administradores, desenvolvida com Node.js, TypeScript, Express e PostgreSQL.

**Documentação interativa no ar:** https://saudemais-api.plovatto.dev/docs/ · **App:** https://saudemais.plovatto.dev/

## Funcionalidades

- Cadastro, login com token opaco guardado como hash, sessões revogáveis e redefinição de senha por e-mail
- Perfis de paciente, médico e administrador, concedidos só pelo administrador
- Vagas geradas pela agenda do médico, pelo horário da unidade e pela política, no fuso de São Paulo
- Reserva dupla impedida no próprio banco por exclusion constraints, mesmo com pedidos simultâneos
- Exames com capacidade por vaga e código público para apresentar na unidade
- Reagendamento e cancelamento conforme a política, com cancelamento tardio dentro da janela
- Confirmação, conclusão com pressão e peso e registro de falta pelo médico
- Resultados de exame recebidos de um laboratório por chave de API, em versões imutáveis, com um simulador diário
- Notificações por perfil e relatórios do administrador
- Manutenção automática que deixa o banco do Neon desligar quando não há uso
- Documentação interativa (Swagger UI) gerada a partir dos schemas Zod

## Tecnologias

- [Node.js](https://nodejs.org/) 22+
- [TypeScript](https://www.typescriptlang.org/)
- [Express](https://expressjs.com/) 5
- [PostgreSQL](https://www.postgresql.org/) 18 e [Drizzle ORM](https://orm.drizzle.team/)
- [Zod](https://zod.dev/) - validação de requisições e variáveis de ambiente
- [zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi) + [Swagger UI](https://github.com/scottie1984/swagger-ui-express) - documentação da API
- [Nodemailer](https://nodemailer.com/) - envio de e-mails
- [Pino](https://getpino.io/) - logging estruturado
- [Vitest](https://vitest.dev/), [Supertest](https://github.com/ladjs/supertest) e [PGlite](https://pglite.dev/) - testes automatizados
- [fast-check](https://fast-check.dev/) - testes baseados em propriedades
- ESLint - análise e padronização do código

## Como Executar

### Pré-requisitos

Antes de começar, tenha instalado:

- [Node.js](https://nodejs.org/) 22.22.2+, 24.15+ ou 26+
- npm
- [PostgreSQL](https://www.postgresql.org/) 18+ com as extensões `citext`, `btree_gist` e `unaccent`, ou [Docker](https://www.docker.com/)

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

Suba um banco local, se ainda não tiver um:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=saudemais postgres:18-alpine
```

Execute em modo de desenvolvimento:

```bash
npm run dev
```

A API estará disponível em:

```text
http://localhost:3001
```

As migrations rodam ao iniciar. Para criar dados de exemplo (especialidades, unidades, exames, médicos e pacientes), rode `npm run db:seed`. Ele cria só o que falta, inclusive as contas de exemplo `paciente@saudemais.test` (senha `paciente-demo-123`) e `medico@saudemais.test` (senha `medico-demo-123`) com alguns agendamentos. São contas comuns: nunca são restauradas e seguem as mesmas regras de qualquer conta.

## Variáveis de Ambiente

As variáveis são definidas no arquivo `.env`, que não deve ser versionado.

Utilize `.env.example` como referência:

```env
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
TRUST_PROXY_HOPS=0
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgres://postgres:postgres@localhost:5432/saudemais
SESSION_TTL_HOURS=12
SESSION_REMEMBER_DAYS=7
ADMIN_EMAIL=
ADMIN_PASSWORD=
MAIL_DRIVER=console
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
APP_PUBLIC_URL=http://localhost:5173
LAB_API_URL=http://localhost:3001
LAB_API_KEY=
```

`ADMIN_EMAIL` e `ADMIN_PASSWORD` criam o primeiro administrador ao iniciar (senha com 12 ou mais caracteres).

`MAIL_DRIVER=console` escreve os e-mails no log; em produção, use `smtp` com `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM`.

`LAB_API_URL` e `LAB_API_KEY` são usadas só pelo simulador do laboratório. A chave é criada em Configurações → Integrações, na área do administrador, e aparece uma única vez.

## Documentação da API

As rotas, os formatos de erro e o contrato da integração com o laboratório são gerados a partir do código e servidos em:

```text
http://localhost:3001/docs (Swagger UI)
http://localhost:3001/docs/openapi.json (OpenAPI 3.1)
```

## Deploy

A API roda em Docker na [Northflank](https://northflank.com/), com o banco no [Neon](https://neon.tech/) (PostgreSQL 18, conexão direta).

O `Dockerfile` tem dois estágios e usuário sem privilégios. A imagem já define `NODE_ENV=production` e escuta na porta `8080`. Em produção, `TRUST_PROXY_HOPS`, `CORS_ORIGIN` (só a origem do front, ex.: `https://saudemais.plovatto.dev`), `APP_PUBLIC_URL` (endereço do front usado nos links dos e-mails), `DATABASE_URL` e `MAIL_DRIVER=smtp` com `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM` são obrigatórias. `SMTP_HOST` e `SMTP_PORT` têm padrão `smtp.gmail.com` e `465`.

A manutenção (pedidos expirados, conclusões automáticas, lembretes e limpeza) roda dentro da própria API. O simulador do laboratório é um job agendado com a mesma imagem, comando `node dist/scripts/lab-simulator.js`, frequência `0 9 * * *` (UTC, 06:00 em São Paulo) e as variáveis `LAB_API_URL` e `LAB_API_KEY`. Para rodar a manutenção como job em vez de dentro da API, use o comando `node dist/jobs/run.js maintenance` e defina `MAINTENANCE_SCHEDULER=false` no serviço.

## Testes

Os testes ficam em `test/`, usando **Vitest** + **Supertest** contra o app Express real, com um PostgreSQL em memória ([PGlite](https://pglite.dev/)), relógio fixo e e-mail em memória.

A suíte em `test-pg/` (`npm run test:pg`) roda em PostgreSQL real e cobre exclusion constraints, pedidos simultâneos e travas. Ela apaga o banco apontado por `TEST_DATABASE_URL` (padrão `postgres://postgres:postgres@localhost:5432/saudemais_test`), então use um banco descartável.

## Scripts

| Comando                        | Descrição                                                |
| ------------------------------ | -------------------------------------------------------- |
| `npm run dev`                  | Inicia o servidor em modo de desenvolvimento             |
| `npm run build`                | Compila o TypeScript para a pasta `dist`                 |
| `npm start`                    | Executa a versão compilada da API                        |
| `npm run typecheck`            | Executa a checagem de tipos sem gerar arquivos           |
| `npm run lint`                 | Executa a análise do código com ESLint                   |
| `npm run lint:fix`             | Corrige problemas de lint automaticamente                |
| `npm test`                     | Executa a suíte de testes em PGlite                      |
| `npm run test:watch`           | Executa os testes em modo de observação                  |
| `npm run test:coverage`        | Executa os testes com relatório de cobertura             |
| `npm run test:pg`              | Executa a suíte em PostgreSQL real                       |
| `npm run db:generate`          | Gera uma migration a partir do schema                    |
| `npm run db:seed`              | Cria o catálogo e as contas de exemplo que faltam        |
| `npm run jobs:run maintenance` | Executa a manutenção uma vez (usa `dist`)                |
| `npm run lab:simulate`         | Publica resultados simulados do laboratório (usa `dist`) |

## Estrutura do Projeto

```text
src/
├── app.ts             # Monta o Express app (usado em produção e nos testes)
├── config/            # Variáveis de ambiente e logger
├── database/          # Pool do pg, migrations, seed e schema do Drizzle
├── docs/              # Registro OpenAPI e schemas comuns
├── jobs/              # Manutenção e agendador interno
├── lab-simulator/     # Lógica do simulador do laboratório
├── lib/               # Erros, relógio, vagas, fuso, paginação e cache
├── mail/              # Interface Mailer, drivers console e SMTP
├── middleware/        # Sessão, perfil, chave de API, limites e tratamento de erros
├── modules/           # Um módulo por domínio (users, appointments, exam-bookings, admin-users...)
├── routes/            # /health e /docs
├── scripts/           # Entrada do simulador do laboratório
└── server.ts          # Ponto de entrada: migrations, contas iniciais e servidor

drizzle/               # Migrations SQL versionadas
test/                  # Testes em PGlite
test-pg/               # Testes em PostgreSQL real
```

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
