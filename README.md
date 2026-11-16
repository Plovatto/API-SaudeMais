# Saúde+ API

[![CI](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml/badge.svg)](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Plovatto/API-SaudeMais/badge)](https://scorecard.dev/viewer/?uri=github.com/Plovatto/API-SaudeMais)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, um sistema de agendamento de consultas e exames com três perfis: o **paciente** agenda consultas e exames, acompanha o histórico, vê os resultados e recebe avisos; o **médico** define a agenda semanal, confirma pedidos e registra a conclusão ou a falta, com pressão e peso; o **administrador** cuida de usuários, perfis, catálogo, política de agendamento, integrações e relatórios. Os resultados de exame chegam por uma integração com um laboratório parceiro, simulada por um job diário. É um projeto de portfólio, com Node.js, TypeScript, Express e PostgreSQL.

| | |
|---|---|
| **Aplicação no ar** | https://plovatto.github.io/SaudeMais |
| **Documentação interativa da API** | https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/ |
| **Repositório do front-end** | [Plovatto/SaudeMais](https://github.com/Plovatto/SaudeMais) |
| **Quadro do projeto** | [Saúde+](https://github.com/users/Plovatto/projects/2) |

## Sumário

- [Funcionalidades](#funcionalidades)
- [Decisões técnicas](#decisões-técnicas)
- [Arquitetura](#arquitetura)
- [Modelo de dados](#modelo-de-dados)
- [Como executar localmente](#como-executar-localmente)
- [Deploy](#deploy)
- [API](#api)
- [Integração com o laboratório](#integração-com-o-laboratório)
- [Contas de demonstração](#contas-de-demonstração)
- [Segurança e LGPD](#segurança-e-lgpd)
- [Testes](#testes)
- [Fluxo de trabalho](#fluxo-de-trabalho)
- [Licença](#licença)

## Funcionalidades

**Contas e acesso**

- Cadastro, login e logout com sessão por token opaco, troca de senha, lista e encerramento de sessões e redefinição de senha por e-mail
- Todo cadastro nasce paciente; só o administrador concede os perfis de médico e de administrador, e cada rota exige o perfil certo

**Paciente**

- Lista de médicos com busca e vagas livres por período, calculadas pela agenda do médico, pelo horário da unidade e pela política de agendamento, no fuso de São Paulo
- Pedido de consulta só em vaga gerada, sem horário duplicado para o médico nem para o paciente, mesmo com pedidos simultâneos, e com limite de 5 agendamentos ativos
- Agendamento de exames nas vagas da unidade, com os lugares restantes de cada vaga e um código público para apresentar na unidade
- Início e agendamentos nas abas agendados e realizados, com filtros, totais e as ações permitidas calculadas pela política
- Cancelamento a qualquer momento, marcado como tardio dentro da janela da política, e reagendamento na mesma linha e em uma transação, até o limite de reagendamentos: a vaga antiga só é liberada se a nova for garantida
- Resultados de exame com a versão atual e as anteriores, e pressão e peso mais recentes no início

**Médico**

- Agenda semanal em faixas de horário, sem sobreposição
- Início e agenda nas abas a confirmar, confirmadas e histórico, com o resumo de hoje
- Confirmação e cancelamento condicionados ao horário que a tela mostrava, com aviso ao paciente
- Conclusão, com pressão e peso validados pela API e por checks no banco, ou registro de falta das consultas que já começaram
- Leitura dos resultados de exame do paciente, só com uma consulta de avaliação de exames recente

**Administrador**

- Painel e relatórios por período: totais pela situação atual, cancelamentos tardios e por autor, taxa de faltas, série diária ou semanal e itens mais procurados, só com números
- Usuários: busca, edição de nome e telefone, desativação com cancelamento dos agendamentos futuros e aviso à outra parte, link de redefinição de senha e perfis de médico e de administrador
- Catálogo de especialidades, unidades com horários, tipos de exame e ofertas por unidade, política de agendamento e chaves das integrações; item com agendamento futuro não pode ser desativado
- Auditoria de cada alteração administrativa

**Para todos**

- Notificações por perfil da área aberta, com o contador de não lidas servido da memória da API
- Documentação interativa (Swagger UI) gerada a partir dos schemas Zod, com exemplos e as respostas possíveis de cada rota

## Decisões técnicas

| Decisão | Por quê |
|---|---|
| **Express 5 + TypeScript + Drizzle ORM + Zod** | Stack enxuta e explícita. O Express 5 propaga erros de handlers `async` sem wrapper. O Drizzle fica perto do SQL e gera migrations versionadas; o que ele não gera (extensões, exclusion constraints, triggers) é escrito à mão em migrations `--custom`. O Zod valida corpo, query, variáveis de ambiente e alimenta o OpenAPI 3.1, que o front usa para gerar os tipos |
| **PostgreSQL 18 no Neon, com exclusion constraints** | A regra "sem reserva dupla" fica no banco, não só na aplicação. Consultas e exames vivem em uma única tabela `bookings`, e três `EXCLUDE USING gist` sobre `tstzrange(starts_at, ends_at)` impedem horário duplicado para o médico e para o paciente e garantem a capacidade de cada exame por **raias** (`lane`): um exame ocupa a menor raia livre entre 1 e a capacidade, e duas reservas na mesma raia não se sobrepõem. Pedidos simultâneos perdem para a constraint, que vira `409` com código próprio |
| **Token opaco em `Authorization: Bearer`, guardado como hash** | Front (GitHub Pages) e API ficam em sites diferentes, o que inviabiliza cookie de sessão. O token tem 32 bytes aleatórios e o banco guarda só o SHA-256: um vazamento do banco não dá acesso a sessões. Validade deslizante com teto absoluto, e revogação apagando a linha |
| **Status calculado em uma única expressão SQL** | Pedido pendente cujo horário chegou é `expired`, e consulta confirmada que já começou está "aguardando registro". Isso é calculado na consulta, com o instante do relógio injetado, e a mesma expressão serve listas, contadores e relatórios; a manutenção só grava o que a expressão já mostra |
| **Travas em ordem fixa e travas consultivas** | Todo fluxo trava na mesma ordem (usuário, catálogo, perfil ou oferta, agendamento) e nunca usa `FOR UPDATE` em `users`, para não conflitar com checagens de chave estrangeira. Travas consultivas protegem as migrations, o conjunto de administradores (nunca fica sem nenhum), o limite de e-mails e a manutenção (`pg_try_advisory_xact_lock`: uma segunda execução só pula). Deadlock tem uma nova tentativa, e efeitos fora do banco acontecem depois do commit |
| **Manutenção que deixa o Neon dormir** | O plano gratuito do Neon desliga o banco após 5 min sem uso e cobra por hora de computação. Por isso `/health` não toca o banco, sessões e contador de notificações ficam em cache na memória, e a manutenção roda dentro da API de forma oportunista: ao iniciar e quando o banco já está ativo por uso real, no mínimo uma vez por dia. Um job de hora em hora acordaria o banco 24 vezes por dia |
| **Integração com laboratório por chave de API** | O laboratório usa só a API pública, com chave em `X-Api-Key` guardada como hash, exibida uma vez e revogável. A worklist não tem dados pessoais. A publicação é idempotente, e cada resultado gera versões imutáveis (um trigger recusa `UPDATE`): retificar cria uma versão nova |
| **LGPD por minimização** | Dados de saúde são dados sensíveis. Observações, motivos, valores de resultado e medidas nunca vão para logs, auditoria ou notificações; o administrador não vê resultados; leituras de resultado e ações administrativas ficam na auditoria; contas são desativadas, não apagadas |
| **Erros por código** | Toda resposta de erro é `{ message, code, fields? }`: o front traduz pelo `code` e mostra `fields` junto de cada campo |

## Arquitetura

```text
src/
  app.ts, server.ts   montagem do Express e inicialização (migrations, contas iniciais, agendador)
  config/             variáveis de ambiente validadas e logger
  database/           pool do pg, migrations, seed e schema do Drizzle (um arquivo por agregado)
  docs/               registro OpenAPI, schemas comuns e Swagger UI
  jobs/               manutenção, agendador interno e entrada dos jobs
  lab-simulator/      simulador do laboratório (entrada em scripts/lab-simulator.ts)
  lib/                erros, relógio, vagas, fuso, paginação, tradução de erros do Postgres, cache
  mail/               interface Mailer, drivers console e SMTP e fila de envio
  middleware/         sessão, perfil, chave de API, limites e tratamento de erros
  modules/            um módulo por domínio
drizzle/              migrations SQL versionadas
test/                 suíte em PGlite
test-pg/              suíte em PostgreSQL real
```

Os módulos de `src/modules` são `users`, `password-reset`, `catalog`, `doctors`, `doctor-schedule`, `doctor-agenda`, `appointments`, `exam-bookings`, `bookings` (regras comuns aos dois tipos de agendamento), `patient-bookings`, `exam-results`, `lab-integration`, `notifications`, `admin-users`, `admin-home`, `admin-reports` e `demo` (contas de demonstração).

Cada módulo segue as mesmas camadas:

```text
requisição → routes (rota, limite, sessão, perfil, documentação OpenAPI)
           → controller (valida com Zod e formata a resposta)
           → service (regras, política, transações, notificações)
           → repository (consultas Drizzle e SQL)
```

O `index.ts` de cada módulo expõe uma função `create<Módulo>Module(deps)` que monta repository, service, controller e router. `createModules` em `src/modules/index.ts` é a única composição: recebe banco, relógio, fila de e-mail e política de sessão, cria os serviços compartilhados (cache de sessões, notificações, regras de agendamento) e os injeta nos módulos que dependem deles. O servidor, os jobs e os testes usam a mesma composição; os testes trocam só o banco (PGlite), o relógio (fixo) e o e-mail (em memória).

Outras convenções:

- Toda comparação de tempo usa o instante do `Clock` injetado; `now()` do banco aparece só em valores padrão.
- Erros do Postgres são traduzidos pelo código e pelo nome da constraint (`pg-errors.ts`): exclusão vira vaga ocupada, unicidade vira nome ou e-mail em uso. O que não é reconhecido vira `500`, sem detalhes.
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
  unit_exam_offers ||--o{ bookings : "exame"
  bookings ||--o{ booking_events : "histórico"
  bookings ||--o| health_metrics : "medidas"
  bookings ||--o| exam_results : "resultado"
  exam_results ||--|{ exam_result_versions : "versões"
  integration_clients ||--o{ exam_results : "publica"
  users ||--o{ notifications : "recebe"
```

Também existem `terms_acceptances`, `password_reset_tokens`, `settings` (linha única com a política de agendamento) e `audit_logs` (sem chave estrangeira, para o registro sobreviver ao alvo).

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

Convenções: chaves `uuid` com `uuidv7()`; conjuntos fechados como `text` com `CHECK` em vez de enum nativo; datas em `timestamptz` e horários do dia em minutos desde 00:00; nomes de catálogo em `citext`; todo texto livre com limite de tamanho; toda constraint com nome explícito, porque a tradução de erros depende dele.

## Como executar localmente

### Pré-requisitos

- [Node.js](https://nodejs.org/) 22.22.2+, 24.15+ ou 26+ (26 LTS recomendado) e npm
- [PostgreSQL](https://www.postgresql.org/) 18 ou superior, com as extensões `citext` e `btree_gist` disponíveis

### Instalação

```bash
git clone https://github.com/Plovatto/API-SaudeMais.git
cd API-SaudeMais
npm install
cp .env.example .env
npm run dev
```

Ajuste `DATABASE_URL` no `.env` para o seu PostgreSQL. As migrations pendentes são aplicadas quando a API inicia, e ela fica disponível em `http://localhost:3001`, com a documentação em `http://localhost:3001/docs`.

Para popular o banco com dados de demonstração (especialidades, unidades Central e Sul com horários, tipos de exame, ofertas, médicos e pacientes de exemplo):

```bash
npm run db:seed
```

O seed pode rodar quantas vezes for preciso: só cria o que falta, mantém o que o administrador já cadastrou com o mesmo nome e não altera contas existentes. As contas de exemplo recebem senhas aleatórias que não são exibidas. No fim, recria os agendamentos das contas de demonstração se a restauração diária ainda não aconteceu, com a mesma trava da manutenção. Com `NODE_ENV=production`, o seed se recusa a rodar sem `SEED_ALLOW_PRODUCTION=1`.

### Scripts

| Script | Descrição |
|---|---|
| `npm run dev` | Inicia em modo de desenvolvimento, recarregando a cada alteração |
| `npm run build` | Compila para `dist/` |
| `npm start` | Executa a versão compilada |
| `npm run typecheck` | Verifica os tipos |
| `npm run lint` / `npm run lint:fix` | Analisa o código com ESLint / corrige o que for automático |
| `npm test` | Roda a suíte em PGlite, sem infraestrutura |
| `npm run test:watch` | Roda a suíte em modo observação |
| `npm run test:coverage` | Roda a suíte com relatório de cobertura |
| `npm run test:pg` | Roda a suíte em PostgreSQL real (`TEST_DATABASE_URL`) |
| `npm run db:generate` | Gera uma migration a partir do schema |
| `npm run db:seed` | Cria os dados de demonstração |
| `npm run jobs:run maintenance` | Roda as rotinas de manutenção uma vez (usa `dist/`) |
| `npm run lab:simulate` | Publica resultados simulados pela API do laboratório (usa `dist/`) |

Extensões, exclusion constraints, triggers e índices parciais são escritos à mão em uma migration vazia:

```bash
npx drizzle-kit generate --custom --name=nome_da_migration
```

### Testes locais

`npm test` usa um PostgreSQL em memória ([PGlite](https://pglite.dev/), também 18) com as mesmas migrations, e não precisa de banco instalado.

`npm run test:pg` cobre o que depende de travas e concorrência reais. Aponte `TEST_DATABASE_URL` para um banco descartável (o padrão é `postgres://postgres:postgres@localhost:5432/saudemais_test`): a suíte apaga os schemas `public` e `drizzle` desse banco. Um jeito rápido de subir um:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=saudemais_test postgres:18-alpine
npm run test:pg
```

## Deploy

A API roda em um container Docker na [Northflank](https://northflank.com/), o banco é um PostgreSQL 18 no [Neon](https://neon.tech/) (conexão direta, sem pooler) e o front é publicado no GitHub Pages.

### Imagem Docker

O `Dockerfile` tem dois estágios, imagens base fixadas por digest e roda com usuário sem privilégios. A imagem define `NODE_ENV=production` e escuta na porta `8080`; ao receber `SIGTERM`, para o agendador, termina as requisições em andamento, espera os e-mails da fila e encerra. Para testar localmente, em modo de desenvolvimento:

```bash
docker build -t api-saudemais .
docker run --rm -p 8080:8080 -e NODE_ENV=development \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/saudemais api-saudemais
```

Em produção, a API não inicia sem as variáveis marcadas como obrigatórias abaixo. O CI constrói a imagem, a executa contra um PostgreSQL 18, confere `/health`, que o processo não roda como root e que o desligamento termina com código 0.

### Variáveis de ambiente

As variáveis ficam no `.env` localmente (use o `.env.example` como modelo) e nas variáveis do serviço na Northflank em produção. Variáveis vazias são tratadas como não definidas.

| Variável | Obrigatória em produção | O que faz |
|---|---|---|
| `NODE_ENV` | | `development`, `test` ou `production` (padrão quando não definida) |
| `PORT` | | Porta HTTP (padrão `3001`; `8080` na imagem) |
| `LOG_LEVEL` | | Nível do log do Pino (padrão `info`) |
| `TRUST_PROXY_HOPS` | Sim | Número de proxies reversos na frente da API, para os limites usarem o IP real do usuário; `0` quando a API recebe as conexões diretamente |
| `CORS_ORIGIN` | Sim | Origem do front, sem caminho (por exemplo, `https://plovatto.github.io`) |
| `APP_PUBLIC_URL` | Sim | Endereço do front com o caminho (por exemplo, `https://plovatto.github.io/SaudeMais`), usado nos links dos e-mails |
| `DATABASE_URL` | Sim | Conexão direta com o PostgreSQL |
| `SESSION_TTL_HOURS` | | Duração de uma sessão sem uso, sem "Lembrar de mim" (padrão 12) |
| `SESSION_REMEMBER_DAYS` | | Duração de uma sessão com "Lembrar de mim" e teto de qualquer sessão (padrão 7) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | | Criam o primeiro administrador ao iniciar; as duas ou nenhuma, senha com 12+ caracteres. Uma conta existente só vira administradora se a senha dela for igual a `ADMIN_PASSWORD`; senão, a API não inicia |
| `DEMO_ACCOUNTS_ENABLED` | | Garante as contas de demonstração ao iniciar e as restaura todo dia (padrão `true`) |
| `MAINTENANCE_SCHEDULER` | | Liga o agendador interno da manutenção (padrão `true` em produção e `false` fora dela) |
| `MAIL_DRIVER` | Sim, `smtp` | `console` escreve os e-mails no log (só fora de produção); `smtp` envia de verdade |
| `SMTP_HOST`, `SMTP_PORT` | | Servidor SMTP (padrão `smtp.gmail.com` e `465`) |
| `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Com `smtp` | Usuário, senha de app e remetente |
| `LAB_API_URL`, `LAB_API_KEY` | Só no simulador | Endereço da API e chave da integração usados por `lab:simulate` |
| `SEED_ALLOW_PRODUCTION` | | `1` permite rodar o seed com `NODE_ENV=production` |
| `TEST_DATABASE_URL` | Só nos testes | Banco descartável de `npm run test:pg` |

### Rotinas agendadas

| Rotina | Onde roda | Frequência |
|---|---|---|
| Manutenção | Dentro da API (padrão) ou job agendado opcional | Oportunista, no mínimo diária |
| Simulador do laboratório | Job agendado da Northflank, mesma imagem | Uma vez por dia |

**Manutenção.** Cada passo roda na própria transação, pode rodar de novo sem efeito duplicado e registra no log só as contagens:

1. Pedidos de consulta pendentes cujo horário chegou passam a `expired`, e o paciente é avisado.
2. Exames confirmados cujo horário terminou passam a `completed`.
3. Consultas confirmadas que começaram há 72 h ou mais sem registro do médico passam a `completed`, com o sistema como autor.
4. Retenção: apaga sessões vencidas, links de redefinição com mais de 48 h, notificações com mais de 90 dias e auditoria com mais de 180 dias. Agendamentos e resultados não têm prazo de exclusão.
5. Uma vez por dia (fuso de São Paulo), com `DEMO_ACCOUNTS_ENABLED=true`, restaura as [contas de demonstração](#contas-de-demonstração).

Uma execução segura `pg_try_advisory_xact_lock`; se outra estiver em andamento, a nova só registra que pulou.

- **Agendador interno (padrão em produção).** Roda ao iniciar (o banco acabou de acordar para as migrations) e, a cada 5 min, olha só a memória do processo: roda se a última execução foi há 1 h ou mais e a API usou o banco nos últimos 5 min, ou se foi há 24 h ou mais. Assim o Neon continua podendo desligar. Os contadores de não lidas são atualizados na hora.
- **Job agendado (alternativa opcional).** Mesma imagem e variáveis da API, comando `node dist/jobs/run.js maintenance`, frequência `0 * * * *`, e `MAINTENANCE_SCHEDULER=false` na API. Ele acorda o banco de hora em hora e consome a cota do Neon; termina com código 0 ao concluir ou pular e 1 ao falhar, e os avisos que cria aparecem no contador quando o cache vence (até 10 min).

**Simulador do laboratório.** Job agendado com a mesma imagem, comando `node dist/scripts/lab-simulator.js`, frequência `0 9 * * *` em UTC (06:00 em São Paulo) e só as variáveis `LAB_API_URL` e `LAB_API_KEY` (a chave é criada na área do administrador, em Integrações, e aparece uma única vez). Ele fala com a API por HTTP, sem `DATABASE_URL`, e acorda o banco uma vez por dia. Detalhes em [Simulador](#simulador).

## API

A documentação completa é gerada a partir do código e servida pela própria API em [`/docs`](https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/) (Swagger UI), com autenticação, formato de erro, datas, paginação, exemplos e as respostas possíveis de cada rota. O documento OpenAPI 3.1, usado pelo front para gerar os tipos, fica em `/docs/openapi.json`.

Rotas protegidas recebem o token em `Authorization: Bearer <token>`; as rotas do laboratório usam `X-Api-Key`. Recurso de outra pessoa responde `404`.

| Grupo | Prefixo principal | Acesso |
|---|---|---|
| Sistema | `/health`, `/docs` | Público; `/health` não consulta o banco |
| Contas | `/api/users`, `/api/password-reset` | Público |
| Perfil | `/api/me` | Login |
| Catálogo | `/api/specialties`, `/api/units`, `/api/exam-types` | Login |
| Agendamento | `/api/doctors`, `/api/appointments`, `/api/exam-availability`, `/api/exam-bookings` | Paciente; detalhe, confirmação, conclusão e cancelamento de consulta também para o médico dela |
| Paciente | `/api/patient` | Paciente |
| Médico | `/api/doctor` | Médico |
| Notificações | `/api/notifications` | Login, por perfil da área aberta (`role`) |
| Administração | `/api/admin` | Administrador |
| Integrações | `/api/integrations/lab` | Chave de API |

<details>
<summary>Todas as rotas</summary>

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
| GET | `/api/doctors` | Médicos com especialidade e unidade (filtros `specialtyId`, `search`; paciente) |
| GET | `/api/doctors/{id}/availability` | Vagas livres de um médico entre `from` e `to`, até 31 dias; `rescheduling` libera a vaga da própria consulta (paciente) |
| POST | `/api/appointments` | Pede uma consulta em uma vaga livre; nasce pendente e avisa o médico (paciente) |
| GET | `/api/appointments/{id}` | Detalhe e histórico da consulta (paciente dela ou médico que a atende) |
| POST | `/api/appointments/{id}/confirm` | Confirma um pedido pendente e avisa o paciente (médico que a atende) |
| POST | `/api/appointments/{id}/complete`, `/no-show` | Conclui, com pressão e peso opcionais em `metrics`, ou registra falta (médico que a atende) |
| POST | `/api/appointments/{id}/cancel` | Cancela e avisa a outra parte; motivo obrigatório para o médico |
| POST | `/api/appointments/{id}/reschedule` | Troca o horário dentro da política; volta a pendente e avisa o médico (paciente) |
| GET | `/api/exam-availability` | Vagas de um exame na unidade entre `from` e `to`, até 31 dias, com os lugares restantes (paciente) |
| POST | `/api/exam-bookings` | Agenda um exame; nasce confirmado, com código público (paciente) |
| GET | `/api/exam-bookings/{id}` | Detalhe, preparo e histórico do exame (paciente dele) |
| POST | `/api/exam-bookings/{id}/cancel` | Cancela o exame e libera o lugar (paciente dele) |
| POST | `/api/exam-bookings/{id}/reschedule` | Troca o horário dentro da política, sujeito à capacidade (paciente dele) |
| GET | `/api/patient/home` | Próximos agendamentos, totais, último aviso e a pressão e o peso mais recentes |
| GET | `/api/patient/bookings` | Agendamentos por aba `scope`, com filtros `kind` e `status` e ações permitidas |
| GET | `/api/patient/exam-results/{bookingId}` | Resultado de um exame, com a versão atual e as anteriores |
| GET | `/api/doctor/home` | Resumo de hoje, próximos pedidos, totais e último aviso |
| GET | `/api/doctor/appointments` | Consultas por aba `tab`, a partir do dia `from`, com ações permitidas |
| GET, PUT | `/api/doctor/schedule` | Agenda semanal, em minutos desde 00:00 |
| GET | `/api/doctor/patients/{patientId}/exam-results` | Resultados do paciente, com avaliação de exames nos últimos 30 dias |
| GET | `/api/notifications` | Avisos no perfil `role`, do mais novo para o mais antigo |
| GET | `/api/notifications/unread-count` | Total de não lidos no perfil `role`, servido da memória |
| POST | `/api/notifications/{id}/read` | Marca um aviso como lido |
| POST | `/api/notifications/read-all` | Marca como lidos todos os avisos do perfil `role` |
| GET, PATCH | `/api/me` | Dados da própria conta; altera nome ou telefone |
| POST | `/api/me/password` | Troca a senha e encerra as outras sessões |
| GET, DELETE | `/api/me/sessions` | Lista as sessões ativas; sai de todas |
| GET | `/api/admin/home` | Números do painel, com as consultas de hoje |
| GET | `/api/admin/reports` | Totais por situação no período `from`–`to` (padrão: últimos 30 dias; máximo 366), com série diária ou semanal |
| GET | `/api/admin/users` | Lista e busca usuários |
| GET, PATCH | `/api/admin/users/{id}` | Vê e altera nome e telefone |
| GET | `/api/admin/users/{id}/deactivation-impact` | Agendamentos afetados por desativar |
| POST | `/api/admin/users/{id}/deactivate`, `/reactivate` | Desativa e reativa a conta |
| POST | `/api/admin/users/{id}/password-reset` | Envia link de redefinição de senha |
| POST, DELETE | `/api/admin/users/{id}/roles/admin` | Concede e remove o perfil de administrador |
| POST, PATCH, DELETE | `/api/admin/users/{id}/doctor-profile` | Cria, altera e remove o perfil médico |
| GET, POST | `/api/admin/specialties` | Lista e cria especialidades |
| PATCH | `/api/admin/specialties/{id}` | Altera, ativa ou desativa uma especialidade |
| GET, POST | `/api/admin/units` | Lista e cria unidades com horários |
| PATCH | `/api/admin/units/{id}` | Altera, ativa ou desativa uma unidade |
| GET, POST | `/api/admin/exam-types` | Lista e cria tipos de exame |
| PATCH | `/api/admin/exam-types/{id}` | Altera, ativa ou desativa um tipo de exame |
| GET | `/api/admin/units/{id}/exam-offers` | Exames oferecidos pela unidade |
| PUT | `/api/admin/units/{id}/exam-offers/{examTypeId}` | Oferece um exame na unidade, com a capacidade por vaga |
| GET, PUT | `/api/admin/policy` | Política de agendamento |
| GET, POST | `/api/admin/integration-clients` | Lista as integrações e cria uma, com a chave exibida uma única vez |
| POST | `/api/admin/integration-clients/{id}/revoke` | Revoga a chave de uma integração |
| GET | `/api/integrations/lab/worklist` | Exames do dia `date` que aguardam resultado, só com os códigos |
| POST | `/api/integrations/lab/results` | Publica ou retifica o resultado de um exame |
| GET | `/docs` | Documentação interativa |
| GET | `/docs/openapi.json` | Documento OpenAPI 3.1 |

</details>

### Formato de erro

```json
{ "message": "Dados inválidos.", "code": "VALIDATION_ERROR", "fields": { "email": "E-mail inválido." } }
```

| Status | Códigos principais |
|---|---|
| 400 | `VALIDATION_ERROR` (com `fields`), `INVALID_JSON` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_API_KEY` |
| 403 | `FORBIDDEN`, `FORBIDDEN_NO_LINK`, `PROTECTED_ACCOUNT` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `SLOT_TAKEN`, `PATIENT_CONFLICT`, `NO_CAPACITY`, `INVALID_STATE`, `NOT_STARTED`, `RESCHEDULE_LIMIT`, `RESCHEDULE_WINDOW_CLOSED`, `EMAIL_TAKEN`, `NAME_TAKEN`, `IN_USE`, `RESULT_FINAL`, `RESULT_EXISTS` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `OUTSIDE_AVAILABILITY`, `ACTIVE_LIMIT`, `SAME_SLOT`, `REASON_REQUIRED`, `NOT_ELIGIBLE`, `WRONG_RESULT_FORMAT` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR`, sem detalhes internos |
| 503 | `SERVER_BUSY`, servidor ocupado conferindo senhas |

A lista completa, com o significado de cada código, está na [documentação](https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/).

## Integração com o laboratório

O laboratório parceiro (ou o simulador) usa só a API pública, autenticado pelo cabeçalho `X-Api-Key`:

1. O administrador cria a integração em `POST /api/admin/integration-clients` e recebe a chave, no formato `slab_<prefixo de 8 caracteres>_<segredo de 32 bytes>`, só nessa resposta: o banco guarda o hash SHA-256 e o prefixo visível. `POST /api/admin/integration-clients/{id}/revoke` revoga na hora. Criar e revogar ficam na auditoria.
2. `GET /api/integrations/lab/worklist?date=AAAA-MM-DD` lista os exames do dia (fuso de São Paulo) que podem receber resultado e ainda não têm, cada um só com o código público, o código do tipo de exame e o início.
3. `POST /api/integrations/lab/results` publica o resultado com `externalId`, `examCode`, `status` (`final` ou `amended`), `issuedAt` e `items` (exame laboratorial: nome, valor, unidade, faixa de referência e indicador `normal`, `low`, `high` ou `critical`) ou `report` (exame de imagem: laudo em texto).

A publicação trava o exame (`FOR NO KEY UPDATE`) e compara o conteúdo com a versão atual por igualdade de `jsonb`:

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

Cada versão nova conclui o exame, grava o evento `result_received`, avisa o paciente com `exam_result_available` e fica na auditoria com a versão e o status, nunca com o conteúdo. Cada chave tem um limite próprio de 60 requisições por minuto.

**Leitura.** O paciente lê o resultado do próprio exame em `GET /api/patient/exam-results/{bookingId}`, com a versão atual (`current`) e as anteriores (`previous`). O médico lê os resultados de um paciente em `GET /api/doctor/patients/{patientId}/exam-results` só quando tem com ele uma consulta de avaliação de exames (`exam_review`) confirmada ou concluída que começou há no máximo 30 dias; caso contrário, inclusive para um paciente inexistente, recebe `403` `FORBIDDEN_NO_LINK`, sem revelar se o paciente existe. Cada leitura fica na auditoria como `exam_result.read`, sem os valores, e o administrador não tem rota que devolva resultados.

### Simulador

`npm run lab:simulate` faz o papel do laboratório usando só a API pública: lê a worklist de ontem (fuso de São Paulo) e publica um resultado para cada exame. `hemograma`, `glicemia` e `colesterol` recebem itens com indicador calculado a partir da faixa de referência; `ultrassom` e `raio_x` recebem um laudo em texto; um tipo sem modelo é pulado com um aviso.

Os valores são sorteados a partir do código do exame e o `externalId` é `SIM-<código>`, então repetir a publicação gera o mesmo conteúdo e recebe `unchanged`. Opções: `--date=AAAA-MM-DD` (padrão: ontem) e `--amend-chance=0..1` (chance de enviar uma retificação logo depois; padrão `0`). Cada requisição tem tempo limite de 15 s; erro de rede ou `5xx` tem uma nova tentativa, e `429` espera o `Retry-After` (até 1 min). O log traz só as contagens e, nas falhas, o código público do exame. O processo termina com código 1 se a worklist falhar ou se algum resultado não for publicado.

## Contas de demonstração

A tela de login do front mostra duas contas públicas, que existem só para demonstração (nunca use essas credenciais em contas reais):

| Perfil | E-mail | Senha |
|---|---|---|
| Paciente | `paciente@saudemais.test` | `paciente-demo-123` |
| Médico (também paciente) | `medico@saudemais.test` | `medico-demo-123` |

O médico de demonstração atende Clínica Geral na Unidade Central, com o registro reservado CRM 999999/SP. Não existe conta pública de administrador: o primeiro administrador vem de `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

Como várias pessoas usam as mesmas contas, elas são **protegidas**:

- A API as garante ao iniciar, com `DEMO_ACCOUNTS_ENABLED=true`; os e-mails ficam reservados e o cadastro os recusa. Itens de catálogo que já existem nunca são alterados; se algo impedir a criação, a API registra um aviso e segue sem a conta.
- Senha, nome e telefone não podem ser alterados (`403` `PROTECTED_ACCOUNT`), e "sair de todas as sessões" encerra só a sessão de quem pediu.
- O médico de demonstração só aparece para as contas de demonstração: visitantes não conseguem agendar com ele, e quem entra como médico nunca vê dados de visitantes.
- O limite de tentativas de login por e-mail não vale para essas contas, para um visitante não bloquear os demais; os limites por IP continuam.
- Relatórios e o painel do administrador não contam essas contas.

**Restauração diária.** Uma vez por dia, a manutenção apaga as medidas, os resultados e os agendamentos em que paciente ou médico é uma conta protegida e recria um conjunto de exemplo com datas em dias úteis relativas ao dia: um pedido pendente, uma consulta confirmada, uma do dia, uma concluída com pressão e peso, um exame confirmado, uma avaliação de exames concluída e um exame de glicemia concluído. O resultado da glicemia é publicado pelo mesmo caminho da integração, em nome do `Laboratório de demonstração` (criado pelo sistema, com uma chave que nunca é exibida), em duas versões, `final` e `amended`. A execução fica na auditoria como `demo.restored`, o que impede uma segunda restauração no mesmo dia.

## Segurança e LGPD

**Senhas e sessões**

- Senhas com scrypt (parâmetros gravados com o hash) e login em tempo constante: um e-mail inexistente é verificado contra um hash fictício.
- Token de sessão de 32 bytes, guardado só como hash; validade deslizante com teto absoluto e limite de sessões por usuário.
- A sessão validada fica em um cache em memória de 5 min, limpo no mesmo processo a cada logout, troca de senha, desativação ou mudança de perfil. Como o cache é por processo, rodar mais de uma instância exigiria um cache compartilhado.
- Link de redefinição de senha com hash, válido por 30 min e de uso único, com limites por destinatário e teto diário gravados no banco; a resposta é sempre a mesma, exista ou não o e-mail.

**Requisições**

- Autorização em três passos: sessão, perfil exigido pela rota e conferência de dono na própria consulta ao banco.
- Corpo validado com Zod estrito e limite de 100 kB.
- Limites de requisição por IP em todas as rotas, e no login também por e-mail; a integração tem limite por chave.
- Helmet, CORS só para `CORS_ORIGIN` e sem cookie, portanto sem CSRF.
- Logs estruturados sem query string, cabeçalhos nem corpo, com dados sensíveis ocultados.

**LGPD**

- Observações, motivos de cancelamento, valores de resultado e medidas de saúde nunca vão para logs, auditoria ou notificações.
- O administrador não vê observações, motivos nem resultados; os repositórios do administrador usam lista explícita de colunas.
- Auditoria das ações administrativas, das chaves de integração e de cada leitura de resultado.
- Retenção com prazos definidos e desativação de conta em vez de exclusão.
- O ambiente publicado é de demonstração e avisa no cadastro para não usar dados reais.

Falhas de segurança devem ser reportadas pela [política de segurança](SECURITY.md).

## Testes

| Suíte | Onde roda | Cobre |
|---|---|---|
| `npm test` | Vitest + Supertest + PGlite, relógio fixo e e-mail em memória | Cada rota com sucesso e erros (400, 401, 403, 404, 409, 422), matriz de perfil por rota, acesso a recurso de outra pessoa, geração de vagas, política, manutenção, simulador, variáveis de ambiente, logs sem dados sensíveis e qualidade do documento OpenAPI |
| Propriedades | [fast-check](https://fast-check.dev/), dentro de `npm test` | Vagas geradas nunca se sobrepõem e ficam dentro das faixas da agenda e do horário da unidade |
| `npm run test:pg` | PostgreSQL 18 real, job próprio no CI | Exclusion constraints, pedidos simultâneos na mesma vaga, na mesma capacidade e do mesmo paciente, travas, versões imutáveis de resultado, manutenção e migrations |
| Imagem Docker | CI | Build, inicialização contra PostgreSQL, usuário sem privilégios e desligamento limpo |

Funcionalidades novas e correções chegam com testes.

## Fluxo de trabalho

- O trabalho é planejado no [quadro do projeto](https://github.com/users/Plovatto/projects/2), em fases com milestones. Cada tarefa é uma issue, com uma branch e um pull request.
- Branches com o prefixo do tipo e o sufixo `-api` (por exemplo, `feature/appointments-booking-api`).
- Commits em [gitmoji](https://gitmoji.dev/) com [Conventional Commits](https://www.conventionalcommits.org/), em inglês e minúsculas, por exemplo `:bug: fix: reject overlapping schedule ranges`.
- Pull requests seguem o modelo (o que foi feito, detalhes e testes), fecham a issue com `Closes #n` e entram com merge commit depois do CI.
- O CI roda em cada pull request: lint, typecheck, testes, build e `npm audit` em Node 22, 24 e 26, a suíte em PostgreSQL 18 e o teste da imagem Docker. O OpenSSF Scorecard e o Dependabot acompanham a segurança da cadeia de dependências.
- Mudanças de contrato recebem o rótulo `api-contract` e precisam ser compatíveis com o front já publicado.

Veja o [guia de contribuição](CONTRIBUTING.md).

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
