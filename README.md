# Saúde+ API

[![CI](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml/badge.svg)](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Plovatto/API-SaudeMais/badge)](https://scorecard.dev/viewer/?uri=github.com/Plovatto/API-SaudeMais)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador. Desenvolvida com Node.js, TypeScript e Express.

> Projeto em desenvolvimento. O andamento está no [quadro do projeto](https://github.com/users/Plovatto/projects/2).

**Documentação interativa no ar:** https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/ · **Front-end:** [Plovatto/SaudeMais](https://github.com/Plovatto/SaudeMais)

## Funcionalidades

- Cadastro, login e logout com sessão por token opaco, guardado no banco só como hash
- Perfis de paciente, médico e administrador, com cada rota restrita ao perfil exigido
- Catálogo de especialidades, unidades com horários, tipos de exame e ofertas, com a política de agendamento e registro de auditoria das alterações
- Senhas com scrypt, login em tempo constante e limites de tentativas por IP e por e-mail
- Banco PostgreSQL com migrations em SQL aplicadas ao iniciar
- Configuração centralizada e validada por variáveis de ambiente
- Respostas de erro padronizadas no formato `{ message, code, fields? }`
- Cabeçalhos de segurança com Helmet e CORS restrito à origem do front
- Logging estruturado sem query string, cabeçalhos ou corpo das requisições, e com dados sensíveis ocultados
- Documentação interativa (Swagger UI) gerada a partir dos schemas Zod
- Testes automatizados com Vitest, em PostgreSQL em memória e em PostgreSQL real

## Tecnologias

- [Node.js](https://nodejs.org/) 22, 24 ou 26 (26 LTS recomendado)
- [TypeScript](https://www.typescriptlang.org/)
- [Express](https://expressjs.com/)
- [PostgreSQL](https://www.postgresql.org/) com [Drizzle ORM](https://orm.drizzle.team/)
- [Zod](https://zod.dev/) - validação de requisições e variáveis de ambiente
- [zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi) + [Swagger UI](https://github.com/scottie1984/swagger-ui-express) - documentação da API em OpenAPI 3.1
- [Helmet](https://helmetjs.github.io/) e [cors](https://github.com/expressjs/cors) - segurança HTTP
- [Pino](https://getpino.io/) - logging estruturado
- [Vitest](https://vitest.dev/), [Supertest](https://github.com/ladjs/supertest) e [PGlite](https://pglite.dev/) - testes automatizados
- ESLint - análise e padronização do código

## Como Executar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 22.22.2+, 24.15+ ou 26+
- npm
- [PostgreSQL](https://www.postgresql.org/) 18 ou superior, com as extensões `citext` e `btree_gist` disponíveis

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
SESSION_TTL_HOURS=12
SESSION_REMEMBER_DAYS=7
ADMIN_EMAIL=
ADMIN_PASSWORD=
APP_PUBLIC_URL=http://localhost:5173
MAIL_DRIVER=console
SMTP_USER=
SMTP_PASS=
MAIL_FROM=
```

`NODE_ENV` vale `production` quando não é definida; use `development` localmente, como no `.env.example`.

`CORS_ORIGIN` é a origem do front (esquema, domínio e porta, sem caminho) e é obrigatória em produção. Variáveis vazias são tratadas como não definidas.

`DATABASE_URL` é a conexão direta com o PostgreSQL (sem pooler). As migrations pendentes são aplicadas quando a API inicia.

`TRUST_PROXY_HOPS` é o número de proxies reversos na frente da API. Com o valor certo, os limites de requisição usam o IP de cada usuário em vez do IP do proxy. Mantenha `0` quando a API recebe as conexões diretamente.

`SESSION_TTL_HOURS` é quanto tempo uma sessão sem "Lembrar de mim" dura sem uso (padrão 12). `SESSION_REMEMBER_DAYS` é a duração de uma sessão com "Lembrar de mim" e também o teto de qualquer sessão (padrão 7).

`ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo de 12 caracteres) criam o primeiro administrador ao iniciar a API; defina as duas ou nenhuma. Se a conta já existir, ela só ganha o perfil de administrador quando a senha dela for igual a `ADMIN_PASSWORD`; caso contrário, a API não inicia, para que um cadastro feito antes com esse e-mail não vire administrador.

`APP_PUBLIC_URL` é o endereço do front com o caminho (em produção, `https://plovatto.github.io/SaudeMais`), usado nos links dos e-mails; é obrigatória em produção.

`MAIL_DRIVER` escolhe como os e-mails saem: `console` (padrão, só fora de produção) escreve no log; `smtp` envia pelo servidor configurado em `SMTP_HOST` (padrão `smtp.gmail.com`), `SMTP_PORT` (padrão 465), `SMTP_USER`, `SMTP_PASS` (senha de app do Gmail) e `MAIL_FROM`. Em produção, `smtp` é obrigatório. Os envios acontecem fora da requisição, e uma falha fica só no log.

A API também cria, ao iniciar, a conta protegida de demonstração `paciente@saudemais.test` (senha `paciente-demo-123`), exibida na tela de login.

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

## Docker

A imagem de produção é gerada pelo `Dockerfile`, em dois estágios, e roda com usuário sem privilégios:

```bash
docker build -t api-saudemais .
docker run --rm -p 8080:8080 -e DATABASE_URL=... -e CORS_ORIGIN=http://localhost:5173 api-saudemais
```

A API escuta na porta `8080` dentro do container, aplica as migrations ao iniciar e, ao receber `SIGTERM`, termina as requisições em andamento antes de encerrar. O CI constrói a imagem e a executa contra um PostgreSQL a cada pull request.

## Documentação da API

A documentação é gerada a partir do código e servida pela própria API. Ela explica autenticação, formato de erro, códigos de erro, datas e paginação, e cada rota traz exemplos e as respostas possíveis. Localmente:

```text
http://localhost:3001/docs
```

O documento OpenAPI 3.1, usado pelo front para gerar os tipos, fica em `/docs/openapi.json`.

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Verifica se o servidor está no ar |
| POST | `/api/users/register` | Cria uma conta de paciente |
| POST | `/api/users/login` | Entra e recebe o token de sessão |
| POST | `/api/users/logout` | Encerra a sessão atual |
| POST | `/api/password-reset/request` | Envia o link para redefinir a senha |
| POST | `/api/password-reset/confirm` | Cria uma nova senha com o link |
| GET | `/api/specialties` | Especialidades ativas |
| GET | `/api/units` | Unidades ativas com horários (filtro `examTypeId`) |
| GET | `/api/exam-types` | Tipos de exame ativos |
| GET, POST | `/api/admin/specialties` | Lista e cria especialidades (admin) |
| PATCH | `/api/admin/specialties/{id}` | Altera, ativa ou desativa uma especialidade (admin) |
| GET, POST | `/api/admin/units` | Lista e cria unidades com horários (admin) |
| PATCH | `/api/admin/units/{id}` | Altera, ativa ou desativa uma unidade (admin) |
| GET, POST | `/api/admin/exam-types` | Lista e cria tipos de exame (admin) |
| PATCH | `/api/admin/exam-types/{id}` | Altera, ativa ou desativa um tipo de exame (admin) |
| GET | `/api/admin/units/{id}/exam-offers` | Exames oferecidos pela unidade (admin) |
| PUT | `/api/admin/units/{id}/exam-offers/{examTypeId}` | Oferece um exame na unidade (admin) |
| GET, PUT | `/api/admin/policy` | Política de agendamento (admin) |
| GET | `/api/admin/home` | Números do painel do administrador |
| GET | `/api/admin/users` | Lista e busca usuários (admin) |
| GET, PATCH | `/api/admin/users/{id}` | Vê e altera nome e telefone (admin) |
| GET | `/api/admin/users/{id}/deactivation-impact` | Agendamentos afetados por desativar (admin) |
| POST | `/api/admin/users/{id}/deactivate`, `/reactivate` | Desativa e reativa a conta (admin) |
| POST | `/api/admin/users/{id}/password-reset` | Envia link de redefinição de senha (admin) |
| POST, DELETE | `/api/admin/users/{id}/roles/admin` | Concede e remove o perfil de administrador (admin) |
| POST, PATCH, DELETE | `/api/admin/users/{id}/doctor-profile` | Cria, altera e remove o perfil médico (admin) |
| GET | `/api/me` | Dados da própria conta |
| PATCH | `/api/me` | Altera nome ou telefone |
| POST | `/api/me/password` | Troca a senha e encerra as outras sessões |
| GET | `/api/me/sessions` | Lista as sessões ativas |
| DELETE | `/api/me/sessions` | Sai de todas as sessões |
| GET | `/docs` | Documentação interativa |
| GET | `/docs/openapi.json` | Documento OpenAPI 3.1 |

## Contribuindo

Veja o [guia de contribuição](CONTRIBUTING.md) e a [política de segurança](SECURITY.md).

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
