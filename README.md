# Saúde+ API

[![CI](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml/badge.svg)](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Plovatto/API-SaudeMais/badge)](https://scorecard.dev/viewer/?uri=github.com/Plovatto/API-SaudeMais)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, um sistema de agendamento de consultas e exames com três perfis: o **paciente** agenda consultas e exames, acompanha o histórico, vê os resultados e recebe avisos; o **médico** define a agenda semanal, confirma pedidos e registra a conclusão ou a falta, com pressão e peso; o **administrador** cuida de usuários, perfis, catálogo, política de agendamento, integrações e relatórios. Os resultados de exame chegam por uma integração com um laboratório parceiro, simulada por um job diário. É um projeto de portfólio, com Node.js, TypeScript, Express e PostgreSQL.

| | |
|---|---|
| **Aplicação no ar** | https://plovatto.github.io/SaudeMais/ |
| **Documentação interativa da API** | https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/ |
| **Repositório do front-end** | [Plovatto/SaudeMais](https://github.com/Plovatto/SaudeMais) |
| **Quadro do projeto** | [Saúde+](https://github.com/users/Plovatto/projects/2) |

**Sumário:** [Funcionalidades](#funcionalidades) · [Decisões técnicas](#decisões-técnicas) · [Arquitetura](#arquitetura) · [Modelo de dados](#modelo-de-dados) · [Como executar](#como-executar-localmente) · [Deploy](#deploy) · [API](#api) · [Laboratório](#integração-com-o-laboratório) · [Contas de demonstração](#contas-de-demonstração) · [Segurança e LGPD](#segurança-e-lgpd) · [Testes](#testes) · [Fluxo de trabalho](#fluxo-de-trabalho)

## Funcionalidades

- **Contas:** cadastro, login com token opaco, sessões, troca e redefinição de senha por e-mail; só o administrador concede os perfis de médico e de administrador
- **Vagas:** geradas pela agenda do médico, pelo horário da unidade e pela política, no fuso de São Paulo
- **Consultas:** pedido só em vaga gerada, sem horário duplicado para médico ou paciente, mesmo com pedidos simultâneos, e até 5 agendamentos ativos
- **Exames:** agendamento com os lugares restantes de cada vaga e código público para apresentar na unidade
- **Cancelamento e reagendamento:** cancelamento marcado como tardio dentro da janela da política; reagendamento em uma transação, que só libera a vaga antiga se a nova for garantida
- **Médico:** agenda semanal em faixas, abas a confirmar, confirmadas e histórico, confirmação, conclusão com pressão e peso ou registro de falta
- **Resultados de exame:** recebidos do laboratório em versões imutáveis; o paciente vê todas, o médico só com uma consulta de avaliação de exames recente
- **Administração:** usuários e perfis, catálogo de especialidades, unidades, exames e ofertas, política, chaves de integração e auditoria
- **Relatórios:** totais por situação, cancelamentos tardios, taxa de faltas e série diária ou semanal, só com números
- **Notificações:** por perfil, com o contador de não lidas servido da memória da API
- **Documentação:** Swagger UI gerado a partir dos schemas Zod, com exemplos e as respostas de cada rota

## Decisões técnicas

| Decisão | Por quê |
|---|---|
| **Express 5 + TypeScript + Drizzle ORM + Zod** | Stack enxuta e explícita. O Express 5 propaga erros de handlers `async` sem wrapper. O Drizzle fica perto do SQL e gera migrations versionadas; o que ele não gera (extensões, exclusion constraints, triggers) é escrito à mão em migrations `--custom`. O Zod valida corpo, query e variáveis de ambiente e alimenta o OpenAPI 3.1, de onde o front gera os tipos |
| **PostgreSQL 18 no Neon, com exclusion constraints** | A regra "sem reserva dupla" fica no banco. Consultas e exames vivem em uma única tabela `bookings`, e três `EXCLUDE USING gist` sobre `tstzrange(starts_at, ends_at)` impedem horário duplicado para o médico e para o paciente e garantem a capacidade de cada exame por **raias** (`lane`): um exame ocupa a menor raia livre entre 1 e a capacidade, e reservas na mesma raia não se sobrepõem. Pedidos simultâneos perdem para a constraint, que vira `409` com código próprio |
| **Token opaco em `Authorization: Bearer`, guardado como hash** | Front (GitHub Pages) e API ficam em sites diferentes, o que inviabiliza cookie de sessão. O token tem 32 bytes aleatórios e o banco guarda só o SHA-256: um vazamento do banco não dá acesso a sessões. Validade deslizante com teto absoluto; revogar é apagar a linha |
| **Status calculado em uma única expressão SQL** | Pedido pendente cujo horário chegou é `expired`, e consulta confirmada que já começou está "aguardando registro". Isso é calculado na consulta com o instante do relógio injetado, e a mesma expressão serve listas, contadores e relatórios; a manutenção só grava o que a expressão já mostra |
| **Travas em ordem fixa e travas consultivas** | Todo fluxo trava na mesma ordem (usuário, catálogo, perfil ou oferta, agendamento), sem `FOR UPDATE` em `users`, para não conflitar com checagens de chave estrangeira. Travas consultivas protegem as migrations, o conjunto de administradores (nunca fica vazio), o limite de e-mails e a manutenção (`pg_try_advisory_xact_lock`: uma segunda execução só pula). Deadlock tem uma nova tentativa, e efeitos fora do banco acontecem depois do commit |
| **Manutenção que deixa o Neon dormir** | O plano gratuito do Neon desliga o banco após 5 min sem uso e tem uma cota mensal de horas de computação. Por isso `/health` não toca o banco, sessões e contador de notificações ficam em cache na memória, e a manutenção roda dentro da API de forma oportunista: ao iniciar e quando o banco já está ativo por uso real, no mínimo uma vez por dia. Um job de hora em hora acordaria o banco 24 vezes por dia |
| **Integração com laboratório por chave de API** | O laboratório usa só a API pública, com chave em `X-Api-Key` guardada como hash, exibida uma vez e revogável. A worklist não tem dados pessoais. A publicação é idempotente, e cada resultado gera versões imutáveis (um trigger recusa `UPDATE`): retificar cria uma versão nova |
| **Erros por código** | Toda resposta de erro é `{ message, code, fields? }`: o front traduz pelo `code` e mostra `fields` junto de cada campo |

## Arquitetura

```text
src/
  app.ts, server.ts   montagem do Express e inicialização (migrations, contas iniciais, agendador)
  config/             variáveis de ambiente validadas e logger
  database/           pool do pg, migrations, seed e schema do Drizzle (um arquivo por agregado)
  docs/               registro OpenAPI, descrição da API e schemas comuns
  routes/             /health e /docs (Swagger UI e openapi.json)
  jobs/               manutenção, agendador interno e entrada dos jobs
  lab-simulator/      lógica do simulador do laboratório
  scripts/            entrada do simulador (lab-simulator.ts)
  lib/                erros, relógio, vagas, fuso, paginação, tradução de erros do Postgres, cache
  mail/               interface Mailer, drivers console e SMTP e fila de envio
  middleware/         sessão, perfil, chave de API, limites e tratamento de erros
  modules/            um módulo por domínio
drizzle/              migrations SQL versionadas
test/                 suíte em PGlite
test-pg/              suíte em PostgreSQL real
```

Os módulos são `users`, `password-reset`, `catalog`, `doctors`, `doctor-schedule`, `doctor-agenda`, `appointments`, `exam-bookings`, `bookings` (regras comuns aos dois tipos de agendamento), `patient-bookings`, `exam-results`, `lab-integration`, `notifications`, `admin-users`, `admin-home`, `admin-reports` e `demo` (contas de demonstração). Os módulos com rotas seguem as mesmas camadas:

```text
requisição → routes (rota, limite, sessão, perfil, documentação OpenAPI)
           → controller (valida com Zod e formata a resposta)
           → service (regras, política, transações, notificações)
           → repository (consultas Drizzle e SQL)
```

O `index.ts` de cada módulo expõe `create<Módulo>Module(deps)`, que monta repository, service, controller e router. `createModules` (`src/modules/index.ts`) é a única composição: recebe banco, relógio, fila de e-mail, política de sessão e a URL do front, cria os serviços compartilhados (cache de sessões, notificações, regras de agendamento) e os injeta nos módulos que dependem deles. Servidor, jobs e testes usam a mesma composição; os testes trocam o banco (PGlite), o relógio (fixo) e o e-mail (em memória).

- Toda comparação de tempo usa o instante do `Clock` injetado; `now()` do banco aparece só em valores padrão e no trigger `set_updated_at`.
- Erros do Postgres são traduzidos pelo código e pelo nome da constraint (`src/lib/pg-errors.ts`): exclusão vira vaga ocupada, unicidade vira nome ou e-mail em uso; o resto vira `500`, sem detalhes.
- Vagas são geradas no fuso `America/Sao_Paulo`, nunca com deslocamento fixo.

## Modelo de dados

```mermaid
erDiagram
  users ||--o{ user_roles : "tem"
  users ||--o{ sessions : "abre"
  users ||--o| doctor_profiles : "pode ter"
  specialties ||--o{ doctor_profiles : "classifica"
  units ||--o{ doctor_profiles : "atende em"
  units ||--o{ unit_hours : "abre em"
  units ||--o{ unit_exam_offers : "oferece"
  exam_types ||--o{ unit_exam_offers : "é oferecido"
  doctor_profiles ||--o{ doctor_schedule_days : "agenda"
  doctor_schedule_days ||--o{ doctor_schedule_ranges : "faixas"
  users ||--o{ bookings : "paciente"
  doctor_profiles ||--o{ bookings : "consulta"
  specialties ||--o{ bookings : "consulta"
  units ||--o{ bookings : "local"
  unit_exam_offers ||--o{ bookings : "exame"
  bookings ||--o{ booking_events : "histórico"
  bookings ||--o{ notifications : "avisa"
  bookings ||--o| health_metrics : "medidas"
  bookings ||--o| exam_results : "resultado"
  exam_results ||--|{ exam_result_versions : "versões"
  integration_clients ||--o{ exam_results : "publica"
  users ||--o{ notifications : "recebe"
```

Também existem `terms_acceptances`, `password_reset_tokens`, `settings` (linha única com a política) e `audit_logs` (sem chave estrangeira, para o registro sobreviver ao alvo).

| Regra | Onde fica no banco |
|---|---|
| Médico sem duas consultas no mesmo horário | `bookings_doctor_no_overlap_excl`, para consultas `pending` ou `confirmed` |
| Paciente sem dois agendamentos sobrepostos | `bookings_patient_no_overlap_excl`, para `pending` ou `confirmed` |
| Capacidade de exame por vaga | `bookings_exam_lane_no_overlap_excl` sobre (unidade, tipo de exame, raia), para exames `confirmed` |
| Faixas da agenda do médico sem sobreposição | `doctor_schedule_ranges_no_overlap_excl` |
| Colunas certas para cada tipo de agendamento | `bookings_kind_columns_check`; exame só `confirmed`, `cancelled` ou `completed` |
| Cancelamento coerente (autor, data, motivo obrigatório para o médico) | `bookings_cancellation_check` |
| Resultado só em exame, medidas só em consulta | chave estrangeira composta para `bookings(id, kind)` |
| Resultados imutáveis | triggers `exam_results_immutable` e `exam_result_versions_immutable` |
| Pressão e peso em faixas válidas | checks nomeados em `health_metrics` |

Convenções: chaves `uuid` com `uuidv7()`; conjuntos fechados como `text` com `CHECK`, não enum nativo; datas em `timestamptz` e horários do dia em minutos desde 00:00; nomes de catálogo em `citext`; texto livre com limite de tamanho; toda constraint com nome explícito, porque a tradução de erros depende dele.

## Como executar localmente

**Pré-requisitos:** [Node.js](https://nodejs.org/) 22.22.2+, 24.15+ ou 26+ (26 LTS recomendado) e [PostgreSQL](https://www.postgresql.org/) 18+, com as extensões `citext`, `btree_gist` e `unaccent` (pacote contrib) disponíveis.

```bash
git clone https://github.com/Plovatto/API-SaudeMais.git
cd API-SaudeMais
npm install
cp .env.example .env
# crie o banco (ou suba um com Docker) e ajuste DATABASE_URL no .env
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=saudemais postgres:18-alpine
npm run dev
```

O `.env.example` já aponta para `postgres://postgres:postgres@localhost:5432/saudemais`. As migrations pendentes são aplicadas ao iniciar; a API fica em `http://localhost:3001` e a documentação em `http://localhost:3001/docs`.

`npm run db:seed` cria dados de demonstração (especialidades, unidades Central e Sul, tipos de exame, ofertas, médicos e pacientes de exemplo com senhas aleatórias não exibidas). Pode rodar quantas vezes for preciso: só cria o que falta e não altera contas existentes. Com `NODE_ENV=production`, exige `SEED_ALLOW_PRODUCTION=1`.

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia em modo de desenvolvimento, recarregando a cada alteração |
| `npm run build` / `npm start` | Compila para `dist/` / executa a versão compilada |
| `npm run typecheck` | Verifica os tipos |
| `npm run lint` / `npm run lint:fix` | Analisa o código com ESLint / corrige o que for automático |
| `npm test` / `npm run test:watch` | Roda a suíte em PGlite, sem infraestrutura / em modo observação |
| `npm run test:coverage` | Roda a suíte com relatório de cobertura |
| `npm run test:pg` | Roda a suíte em PostgreSQL real (`TEST_DATABASE_URL`) |
| `npm run db:generate` | Gera uma migration a partir do schema |
| `npm run db:seed` | Cria os dados de demonstração |
| `npm run jobs:run maintenance` | Roda a manutenção uma vez (usa `dist/`) |
| `npm run lab:simulate` | Publica resultados simulados pela API do laboratório (usa `dist/`) |

Extensões, exclusion constraints, triggers e índices parciais vão em migrations escritas à mão: `npx drizzle-kit generate --custom --name=nome_da_migration`.

`npm test` usa um PostgreSQL em memória ([PGlite](https://pglite.dev/), também 18) com as mesmas migrations. `npm run test:pg` cobre travas e concorrência reais: aponte `TEST_DATABASE_URL` para um banco descartável (padrão `postgres://postgres:postgres@localhost:5432/saudemais_test`), porque a suíte apaga os schemas `public` e `drizzle` dele.

## Deploy

A API roda em Docker na [Northflank](https://northflank.com/), o banco é um PostgreSQL 18 no [Neon](https://neon.tech/) (conexão direta, sem pooler) e o front fica no GitHub Pages.

O `Dockerfile` tem dois estágios, imagens base fixadas por digest e usuário sem privilégios. A imagem define `NODE_ENV=production` e escuta na porta `8080`; ao receber `SIGTERM`, para o agendador, termina as requisições em andamento, espera a fila de e-mails e encerra. Para testar localmente, em modo de desenvolvimento:

```bash
docker build -t api-saudemais .
docker run --rm -p 8080:8080 -e NODE_ENV=development \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/saudemais api-saudemais
```

No Linux, acrescente `--add-host=host.docker.internal:host-gateway` ao `docker run`. Em produção, a API não inicia sem as variáveis obrigatórias abaixo. O CI constrói a imagem, a executa contra um PostgreSQL 18 e confere `/health`, o usuário sem privilégios e o desligamento com código 0.

### Variáveis de ambiente

Localmente no `.env` (modelo em `.env.example`); em produção, nas variáveis do serviço. Variáveis vazias valem como não definidas.

| Variável | Obrigatória em produção | O que faz |
|---|---|---|
| `NODE_ENV` | | `development`, `test` ou `production` (padrão quando não definida) |
| `PORT` | | Porta HTTP (padrão `3001`; `8080` na imagem) |
| `LOG_LEVEL` | | Nível do log do Pino (padrão `info`) |
| `TRUST_PROXY_HOPS` | Sim | Proxies reversos na frente da API, para os limites usarem o IP real; `0` sem proxy |
| `CORS_ORIGIN` | Sim | Origem do front, sem caminho (por exemplo, `https://plovatto.github.io`) |
| `APP_PUBLIC_URL` | Sim | Endereço do front com o caminho (por exemplo, `https://plovatto.github.io/SaudeMais`), usado nos links dos e-mails |
| `DATABASE_URL` | Sim | Conexão direta com o PostgreSQL |
| `SESSION_TTL_HOURS` | | Duração de uma sessão sem uso, sem "Lembrar de mim" (padrão 12) |
| `SESSION_REMEMBER_DAYS` | | Duração com "Lembrar de mim" e teto de qualquer sessão (padrão 7) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | | Criam o primeiro administrador ao iniciar; as duas ou nenhuma, senha com 12+ caracteres. Conta existente só vira administradora se a senha dela for igual a `ADMIN_PASSWORD`; senão, a API não inicia |
| `DEMO_ACCOUNTS_ENABLED` | | Garante e restaura todo dia as contas de demonstração (padrão `true`) |
| `MAINTENANCE_SCHEDULER` | | Liga o agendador interno da manutenção (padrão `true` em produção, `false` fora dela) |
| `MAIL_DRIVER` | Sim, `smtp` | `console` escreve os e-mails no log (só fora de produção); `smtp` envia |
| `SMTP_HOST`, `SMTP_PORT` | | Servidor SMTP (padrão `smtp.gmail.com` e `465`) |
| `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Com `smtp` | Usuário, senha de app e remetente |
| `LAB_API_URL`, `LAB_API_KEY` | Só no simulador | Endereço da API e chave da integração usados por `lab:simulate` |
| `SEED_ALLOW_PRODUCTION` | | `1` permite o seed com `NODE_ENV=production` |
| `TEST_DATABASE_URL` | Só nos testes | Banco descartável de `npm run test:pg` |

### Rotinas agendadas

- **Manutenção, dentro da API (padrão).** Roda ao iniciar e, a cada 5 min, olha só a memória do processo: roda se a última execução foi há 1 h ou mais e a API usou o banco nos últimos 5 min, ou se foi há 24 h ou mais. Assim o Neon continua podendo desligar.
- **Manutenção como job (alternativa opcional).** Job agendado da Northflank com a mesma imagem e variáveis, comando `node dist/jobs/run.js maintenance`, frequência `0 * * * *` e `MAINTENANCE_SCHEDULER=false` na API. Acorda o banco de hora em hora e consome a cota do Neon; os avisos que cria aparecem no contador quando o cache vence (até 10 min).
- **Simulador do laboratório (diário).** Job com a mesma imagem, comando `node dist/scripts/lab-simulator.js`, frequência `0 9 * * *` em UTC (06:00 em São Paulo) e só `LAB_API_URL` e `LAB_API_KEY`, criada em Integrações na área do administrador e exibida uma vez. Fala com a API por HTTP, sem `DATABASE_URL`.

<details>
<summary>Passos da manutenção</summary>

Cada passo roda na própria transação, pode rodar de novo sem efeito duplicado e registra no log só as contagens. Uma execução segura `pg_try_advisory_xact_lock`; se outra estiver em andamento, a nova só registra que pulou. O job termina com código 0 ao concluir ou pular e 1 ao falhar.

1. Pedidos de consulta pendentes cujo horário chegou passam a `expired`, e o paciente é avisado.
2. Exames confirmados cujo horário terminou passam a `completed`.
3. Consultas confirmadas que começaram há 72 h ou mais sem registro do médico passam a `completed`, com o sistema como autor.
4. Retenção: apaga sessões vencidas, links de redefinição com mais de 48 h, notificações com mais de 90 dias e auditoria com mais de 180 dias. Agendamentos e resultados não têm prazo de exclusão.
5. Uma vez por dia (fuso de São Paulo), com `DEMO_ACCOUNTS_ENABLED=true`, restaura as [contas de demonstração](#contas-de-demonstração).

</details>

## API

A documentação completa, com a lista de todas as rotas, é gerada a partir do código e servida em [`/docs`](https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/), com autenticação, formato de erro, datas, paginação, exemplos e as respostas de cada rota. O OpenAPI 3.1 fica em `/docs/openapi.json`. Rotas protegidas recebem `Authorization: Bearer <token>`; as do laboratório, `X-Api-Key`. Recurso de outra pessoa responde `404`.

| Grupo | Prefixo principal | Acesso |
|---|---|---|
| Sistema | `/health`, `/docs` | Público; `/health` não consulta o banco |
| Contas | `/api/users`, `/api/password-reset` | Público (logout exige login) |
| Perfil | `/api/me` | Login |
| Catálogo | `/api/specialties`, `/api/units`, `/api/exam-types` | Login |
| Agendamento | `/api/doctors`, `/api/appointments`, `/api/exam-availability`, `/api/exam-bookings` | Paciente; detalhe, confirmação, conclusão, registro de falta e cancelamento de consulta também para o médico dela |
| Paciente | `/api/patient` | Paciente |
| Médico | `/api/doctor` | Médico |
| Notificações | `/api/notifications` | Login, por perfil da área aberta (`role`) |
| Administração | `/api/admin` | Administrador |
| Integrações | `/api/integrations/lab` | Chave de API |

Formato de erro: `{ "message": "Dados inválidos.", "code": "VALIDATION_ERROR", "fields": { "email": "E-mail inválido." } }`

| Status | Códigos principais |
|---|---|
| 400 | `VALIDATION_ERROR` (com `fields`), `INVALID_JSON`, `BAD_REQUEST` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_API_KEY` |
| 403 | `FORBIDDEN`, `FORBIDDEN_NO_LINK`, `PROTECTED_ACCOUNT`, `USER_INACTIVE` (login de conta desativada) |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `SLOT_TAKEN`, `PATIENT_CONFLICT`, `NO_CAPACITY`, `INVALID_STATE`, `NOT_STARTED`, `RESCHEDULE_LIMIT`, `RESCHEDULE_WINDOW_CLOSED`, `EMAIL_TAKEN`, `NAME_TAKEN`, `IN_USE`, `USER_INACTIVE`, `RESULT_FINAL`, `RESULT_EXISTS` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `BAD_REQUEST` (charset ou codificação do corpo não suportados) |
| 422 | `OUTSIDE_AVAILABILITY`, `ACTIVE_LIMIT`, `SAME_SLOT`, `REASON_REQUIRED`, `NOT_ELIGIBLE`, `WRONG_RESULT_FORMAT` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR`, sem detalhes internos |
| 503 | `SERVER_BUSY`, servidor ocupado conferindo senhas |

## Integração com o laboratório

O laboratório parceiro (ou o simulador) usa só a API pública, com o cabeçalho `X-Api-Key`:

1. O administrador cria a integração em `POST /api/admin/integration-clients` e recebe a chave `slab_<prefixo de 8 caracteres>_<segredo de 32 bytes>` só nessa resposta; o banco guarda o hash SHA-256 e o prefixo. `POST /api/admin/integration-clients/{id}/revoke` revoga na hora.
2. `GET /api/integrations/lab/worklist?date=AAAA-MM-DD` lista os exames do dia que podem receber resultado e ainda não têm, só com o código público, o código do tipo de exame e o início.
3. `POST /api/integrations/lab/results` publica com `externalId`, `examCode`, `status` (`final` ou `amended`), `issuedAt` e `items` (laboratorial: nome, valor, unidade, faixa de referência e indicador `normal`, `low`, `high` ou `critical`) ou `report` (imagem: laudo em texto).

Cada versão nova conclui o exame, grava o evento `result_received`, avisa o paciente e fica na auditoria sem o conteúdo. Cada chave tem limite de 60 requisições por minuto. O paciente lê os próprios resultados; o médico só com uma consulta de avaliação de exames (`exam_review`) confirmada ou concluída que começou há no máximo 30 dias, senão recebe `403` `FORBIDDEN_NO_LINK`, sem revelar se o paciente existe. O administrador não tem rota que devolva resultados.

<details>
<summary>Respostas da publicação</summary>

A publicação trava o exame (`FOR NO KEY UPDATE`) e compara o conteúdo com a versão atual por igualdade de `jsonb`.

| Situação | Resposta |
|---|---|
| Primeira publicação | `201`, versão 1 |
| Mesmo `externalId` e mesmo conteúdo | `200` `unchanged`, sem efeito |
| Conteúdo diferente com `amended` | `200` `amended`, nova versão |
| Conteúdo diferente com `final` | `409` `RESULT_FINAL` |
| Outro `externalId` ou outra integração para o mesmo exame | `409` `RESULT_EXISTS` |
| `externalId` já usado em outro exame | `409` `EXTERNAL_ID_TAKEN` |
| Código inexistente | `404` `NOT_FOUND` |
| Exame cancelado ou que ainda não começou | `422` `NOT_ELIGIBLE` |
| `items` em exame de imagem ou `report` em exame laboratorial | `422` `WRONG_RESULT_FORMAT` |
| `issuedAt` mais de 5 min à frente do relógio da API | `422` `ISSUED_IN_FUTURE` |

</details>

<details>
<summary>Simulador</summary>

`npm run lab:simulate` lê a worklist de ontem (fuso de São Paulo) e publica um resultado por exame: `hemograma`, `glicemia` e `colesterol` recebem itens com indicador calculado pela faixa de referência; `ultrassom` e `raio_x`, um laudo; um tipo sem modelo é pulado com aviso. Os valores são sorteados a partir do código do exame e o `externalId` é `SIM-<código>`, então repetir gera o mesmo conteúdo (`unchanged`).

Opções: `--date=AAAA-MM-DD` (padrão: ontem) e `--amend-chance=0..1` (chance de enviar uma retificação logo depois; padrão `0`). Cada requisição tem tempo limite de 15 s; erro de rede ou `5xx` tem uma nova tentativa, e `429` espera o `Retry-After` (até 1 min). O log traz só contagens e, nas falhas, o código público do exame. Termina com código 1 se a worklist falhar ou algum resultado não for publicado.

</details>

## Contas de demonstração

A tela de login do front mostra duas contas públicas, só para demonstração (nunca use essas credenciais em contas reais):

| Perfil | E-mail | Senha |
|---|---|---|
| Paciente | `paciente@saudemais.test` | `paciente-demo-123` |
| Médico (também paciente) | `medico@saudemais.test` | `medico-demo-123` |

O médico atende Clínica Geral na Unidade Central, com o registro reservado CRM 999999/SP. Não há conta pública de administrador. Como várias pessoas usam as mesmas contas, elas são **protegidas**: a API as garante ao iniciar e o cadastro recusa esses e-mails; senha, nome e telefone não mudam (`403` `PROTECTED_ACCOUNT`); "sair de todas" encerra só a própria sessão; o médico de demonstração só aparece para contas de demonstração, então quem entra como médico nunca vê dados de visitantes; o limite de login por e-mail não vale para elas, para um visitante não bloquear os demais; e painel e relatórios não as contam.

<details>
<summary>Restauração diária</summary>

Uma vez por dia, a manutenção apaga as medidas, os resultados e os agendamentos em que paciente ou médico é uma conta protegida e recria um conjunto de exemplo com datas em dias úteis relativas ao dia: um pedido pendente, uma consulta confirmada, uma do dia, uma concluída com pressão e peso, um exame confirmado, uma avaliação de exames concluída e um exame de glicemia concluído. O resultado da glicemia é publicado pelo caminho da integração, em nome do `Laboratório de demonstração` (criado pelo sistema, com uma chave nunca exibida), nas versões `final` e `amended`. A execução fica na auditoria como `demo.restored`, o que impede uma segunda restauração no mesmo dia; o seed usa a mesma trava.

</details>

## Segurança e LGPD

- **Senhas:** scrypt com os parâmetros gravados no hash e login em tempo constante (e-mail inexistente é verificado contra um hash fictício).
- **Sessões:** token de 32 bytes guardado como hash, validade deslizante com teto absoluto e limite por usuário; cache em memória de 5 min, limpo no mesmo processo a cada logout, troca de senha, desativação ou mudança de perfil (mais de uma instância exigiria um cache compartilhado).
- **Redefinição de senha:** link com hash, válido por 30 min e de uso único, com limites por destinatário e teto diário no banco; a resposta é a mesma exista ou não o e-mail.
- **Autorização:** sessão, perfil exigido pela rota e conferência de dono na própria consulta ao banco.
- **Requisições:** Zod estrito, corpo até 100 kB, limites por IP em todas as rotas (no login também por e-mail; na integração, por chave), Helmet e CORS só para `CORS_ORIGIN`, sem cookie e portanto sem CSRF.
- **Logs:** estruturados, sem query string, cabeçalhos nem corpo, com dados sensíveis ocultados.
- **LGPD:** dados de saúde são sensíveis. Observações, motivos, valores de resultado e medidas nunca vão para logs, auditoria ou notificações; o administrador não os vê (os repositórios dele usam lista explícita de colunas); ações administrativas, chaves de integração e leituras de resultado ficam na auditoria; a retenção tem prazos definidos e contas são desativadas, não apagadas. O ambiente publicado avisa no cadastro para não usar dados reais.

Falhas de segurança devem ser reportadas pela [política de segurança](SECURITY.md).

## Testes

| Suíte | Onde roda | Cobre |
|---|---|---|
| `npm test` | Vitest + Supertest + PGlite, relógio fixo e e-mail em memória | Cada rota com sucesso e erros, matriz de perfil por rota, acesso a recurso de outra pessoa, vagas, política, manutenção, simulador, logs sem dados sensíveis e qualidade do OpenAPI |
| Propriedades | [fast-check](https://fast-check.dev/), dentro de `npm test` | Vagas geradas nunca se sobrepõem e ficam dentro das faixas da agenda e do horário da unidade |
| `npm run test:pg` | PostgreSQL 18 real, job próprio no CI | Exclusion constraints, pedidos simultâneos na mesma vaga, capacidade e paciente, travas, versões imutáveis, manutenção e migrations |
| Imagem Docker | CI | Build, inicialização contra PostgreSQL, usuário sem privilégios e desligamento limpo |

## Fluxo de trabalho

Cada tarefa é uma issue no [quadro do projeto](https://github.com/users/Plovatto/projects/2), com branch, commits em [gitmoji](https://gitmoji.dev/) + [Conventional Commits](https://www.conventionalcommits.org/) e pull request com merge depois do CI (lint, typecheck, testes, build e `npm audit` em Node 22, 24 e 26, suíte em PostgreSQL 18 e imagem Docker). Detalhes no [guia de contribuição](CONTRIBUTING.md).

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
