# Saúde+ API

[![CI](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml/badge.svg)](https://github.com/Plovatto/API-SaudeMais/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Plovatto/API-SaudeMais/badge)](https://scorecard.dev/viewer/?uri=github.com/Plovatto/API-SaudeMais)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador. Desenvolvida com Node.js, TypeScript e Express.

> Projeto em desenvolvimento. O andamento está no [quadro do projeto](https://github.com/users/Plovatto/projects/2).

**Documentação interativa no ar:** https://p01--saudemais--pgj2h2jjxzb4.code.run/docs/ · **Front-end:** [Plovatto/SaudeMais](https://github.com/Plovatto/SaudeMais)

## Funcionalidades

- Cadastro, login e logout com sessão por token opaco, guardado no banco só como hash e validado a partir de um cache em memória de 5 min, limpo no mesmo processo a cada logout, troca de senha, desativação ou mudança de perfil
- Perfis de paciente, médico e administrador, com cada rota restrita ao perfil exigido
- Lista de médicos com busca e vagas livres por período, calculadas pela agenda do médico, pelo horário da unidade e pela política de agendamento, no fuso de São Paulo
- Pedido de consulta só em vaga gerada, com exclusion constraints que impedem horário duplicado para o médico e para o paciente, mesmo com pedidos simultâneos, e limite de 5 agendamentos ativos por paciente
- Agendamento de exames nas vagas geradas pelo horário da unidade, com os lugares restantes de cada vaga, capacidade garantida por raias e exclusion constraint mesmo com pedidos simultâneos, código público para apresentar na unidade e cancelamento pelo paciente
- Início e agendamentos do paciente nas abas agendados e realizados, com filtros, totais e as ações permitidas calculadas pela política; cancelamento pelo paciente ou pelo médico, condicionado ao horário que a tela mostrava, com aviso à outra parte e marcação de cancelamento tardio
- Início e agenda do médico nas abas a confirmar, confirmadas e histórico, com o resumo de hoje no fuso de São Paulo, totais e as ações permitidas; confirmação pelo médico condicionada ao horário que a tela mostrava, com aviso ao paciente, e conclusão ou registro de falta das consultas que já começaram e aguardam registro
- Reagendamento de consultas e exames pelo paciente, na mesma linha e em uma transação, até o limite de reagendamentos e, se confirmado, fora da janela da política: a consulta volta a pendente e avisa o médico, o exame continua confirmado e mantém o lugar quando livre, e a vaga antiga só é liberada se a nova for garantida
- Desativar uma conta ou remover o perfil médico cancela os agendamentos ativos futuros e avisa a outra parte; especialidade, unidade, tipo de exame ou oferta com agendamento futuro não podem ser desativados, e a capacidade da oferta não fica abaixo de um lugar ocupado por exame que ainda não terminou
- Integração com o laboratório por chave de API (guardada só como hash, exibida uma vez e revogável pelo administrador): lista de exames do dia que aguardam resultado, sem dados pessoais, e publicação de resultados idempotente, com versões imutáveis, retificação, conclusão do exame e aviso ao paciente
- Notificações por perfil da área aberta, com o contador de não lidas guardado na memória da API para a consulta periódica não acordar o banco
- Relatórios do administrador por período no fuso de São Paulo: totais de consultas e exames pela situação atual, aguardando registro à parte, cancelamentos tardios e por autor, taxa de faltas, série diária (ou semanal acima de 62 dias) e especialidades e exames mais procurados, só com números e sem as contas de demonstração
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
DEMO_ACCOUNTS_ENABLED=true
MAINTENANCE_SCHEDULER=false
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

`DEMO_ACCOUNTS_ENABLED` (padrão `true`) faz a API garantir, ao iniciar, as contas protegidas de demonstração exibidas na tela de login. Com `false`, nenhuma conta de demonstração é criada nem alterada. As credenciais abaixo são públicas e servem só para demonstração; nunca as use em contas reais:

- Paciente: `paciente@saudemais.test` (senha `paciente-demo-123`).
- Médico, também paciente: `medico@saudemais.test` (senha `medico-demo-123`), com perfil de Clínica Geral na Unidade Central e o registro reservado CRM 999999/SP.

Esses e-mails ficam reservados: o cadastro os recusa. Na primeira vez, a especialidade e a unidade do médico são criadas apenas se ainda não existirem, e os horários só entram em uma unidade criada nesse momento; itens que já existem nunca são alterados. Se um desses itens estiver inativo, se o registro já pertencer a outro médico ou se o e-mail já pertencer a uma conta comum, a API registra um aviso no log e segue sem a conta ou o perfil de demonstração.

`MAINTENANCE_SCHEDULER` liga o agendador interno das [rotinas de manutenção](#rotinas-de-manutenção). Quando não é definida, vale `true` em produção e `false` nos demais ambientes.

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
| `npm run db:seed` | Cria os dados de demonstração |
| `npm run jobs:run maintenance` | Roda as rotinas de manutenção uma vez (usa a versão compilada em `dist/`) |

## Banco de Dados

O schema fica em `src/database/schema` e as migrations, em `drizzle/`, como arquivos SQL versionados.

Para criar uma migration a partir de mudanças no schema:

```bash
npm run db:generate
```

Para popular o banco com dados de demonstração (especialidades, unidades Central e Sul com horários, tipos de exame, ofertas, médicos e pacientes de exemplo):

```bash
npm run db:seed
```

O seed pode rodar quantas vezes for preciso: só cria o que falta, mantém o que o administrador já cadastrou com o mesmo nome (tipos de exame são procurados pelo código) e não altera contas existentes. Os médicos de exemplo só recebem perfil quando a conta é criada pelo próprio seed. As contas de exemplo recebem senhas aleatórias que não são exibidas. No fim, o seed recria os agendamentos das contas de demonstração, se a [restauração diária](#rotinas-de-manutenção) ainda não aconteceu no dia; ele usa a mesma trava da restauração, então nunca restaura duas vezes ao mesmo tempo que a manutenção.

Com `NODE_ENV=production`, o seed se recusa a rodar, a menos que `SEED_ALLOW_PRODUCTION=1` esteja definida. O log mostra só o host do banco de destino.

Extensões, exclusion constraints e índices parciais são escritos à mão em uma migration vazia:

```bash
npx drizzle-kit generate --custom --name=nome_da_migration
```

Os testes de `npm test` usam um PostgreSQL em memória (PGlite) com as mesmas migrations. O que depende de travas e concorrência reais fica em `test-pg/` e roda com `npm run test:pg`, apontando `TEST_DATABASE_URL` para um banco descartável: a suíte apaga os schemas `public` e `drizzle` desse banco.

## Rotinas de manutenção

`npm run jobs:run maintenance` executa, nesta ordem, cada passo na própria transação, e registra no log só as contagens:

1. Pedidos de consulta pendentes cujo horário chegou passam a `expired`, com evento do sistema, e o paciente recebe a notificação `appointment_expired`.
2. Exames confirmados cujo horário terminou passam a `completed`.
3. Consultas confirmadas que começaram há 72 h ou mais sem registro do médico passam a `completed`, com o sistema como autor.
4. Retenção: apaga sessões vencidas, links de redefinição de senha com mais de 48 h, notificações com mais de 90 dias e registros de auditoria com mais de 180 dias. Agendamentos não têm prazo de exclusão.
5. Uma vez por dia (no fuso de São Paulo) e só com `DEMO_ACCOUNTS_ENABLED=true`, restaura as contas de demonstração: apaga os agendamentos em que o paciente ou o médico é uma conta protegida (eventos e notificações vão junto) e recria os agendamentos de exemplo da paciente de demonstração com o médico de demonstração: um pedido pendente, uma consulta confirmada, uma do dia (que fica aguardando registro depois do horário), uma concluída, um exame confirmado e um exame concluído, com datas em dias úteis relativas ao dia. Os exames ocupam a menor raia livre, e um horário que um visitante ocupou é pulado. A execução fica registrada na auditoria como `demo.restored`, e é esse registro que impede uma segunda restauração no mesmo dia.

Todos os passos podem rodar de novo sem efeito duplicado, e uma execução segura uma trava consultiva do PostgreSQL (`pg_try_advisory_xact_lock`): se outra execução estiver em andamento, a nova só registra um aviso de que pulou. Os contadores de não lidas das pessoas afetadas são atualizados na hora quando a manutenção roda dentro da API.

Por padrão, em produção, a própria API roda a manutenção (`MAINTENANCE_SCHEDULER`). Para o banco do Neon poder desligar, o agendador aproveita quando o banco já está ativo e roda no mínimo uma vez por dia: roda ao iniciar (o banco acabou de acordar para as migrations) e, a cada 5 min, confere só a memória do processo e roda se a última execução foi há 1 h ou mais e a API usou o banco nos últimos 5 min, ou se a última execução foi há 24 h ou mais. Ao receber `SIGTERM`, o agendador para na hora e o desligamento espera a execução em andamento terminar.

Como alternativa, a manutenção pode rodar como job agendado da Northflank, com a mesma imagem e as mesmas variáveis da API, o comando `node dist/jobs/run.js maintenance` e a frequência `0 * * * *`; nesse caso, defina `MAINTENANCE_SCHEDULER=false` na API. O job é opcional e acorda o banco de hora em hora, o que consome a cota de horas de computação do Neon. Ele termina com código 0 quando conclui ou pula e com 1 quando falha, e as notificações que ele cria aparecem no contador da API quando o cache vence (até 10 min).

## Integração com o laboratório

O laboratório parceiro (ou o simulador) usa só a API pública, autenticado pelo cabeçalho `X-Api-Key`:

1. O administrador cria a integração em `POST /api/admin/integration-clients` e recebe a chave, no formato `slab_<prefixo de 8 caracteres>_<segredo de 32 bytes>`. Ela aparece só nessa resposta: o banco guarda o hash SHA-256 e o prefixo visível, que identifica a chave na lista. `POST /api/admin/integration-clients/{id}/revoke` revoga a chave na hora. Criar e revogar ficam na auditoria.
2. `GET /api/integrations/lab/worklist?date=AAAA-MM-DD` lista os exames do dia (fuso de São Paulo) que podem receber resultado e ainda não têm: confirmados cujo horário começou ou concluídos. Cada um vem só com o código público, o código do tipo de exame e o início.
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

Cada versão nova conclui o exame, grava o evento `result_received`, avisa o paciente com `exam_result_available` e fica na auditoria com a versão e o status, nunca com o conteúdo, que também não vai para os logs nem para as notificações. As versões não podem ser alteradas: um trigger recusa `UPDATE` em `exam_result_versions`. Cada chave tem um limite próprio de 60 requisições por minuto.

## Docker

A imagem de produção é gerada pelo `Dockerfile`, em dois estágios, e roda com usuário sem privilégios:

```bash
docker build -t api-saudemais .
docker run --rm -p 8080:8080 -e DATABASE_URL=... -e CORS_ORIGIN=http://localhost:5173 api-saudemais
```

A API escuta na porta `8080` dentro do container, aplica as migrations ao iniciar e, ao receber `SIGTERM`, termina as requisições em andamento antes de encerrar. O CI constrói a imagem e a executa contra um PostgreSQL a cada pull request.

O cache de sessões fica na memória de cada processo. Depois de revogar uma sessão direto no banco, reinicie a API ou espere até 5 min; rodar mais de uma instância exige um cache compartilhado.

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
| GET | `/api/doctors` | Médicos com especialidade e unidade (filtros `specialtyId`, `search`; paciente) |
| GET | `/api/doctors/{id}/availability` | Vagas livres de um médico entre `from` e `to`, até 31 dias; `rescheduling` libera a vaga da própria consulta na tela de reagendar (paciente) |
| POST | `/api/appointments` | Pede uma consulta em uma vaga livre; nasce pendente e avisa o médico (paciente) |
| GET | `/api/appointments/{id}` | Detalhe e histórico da consulta (paciente dela ou médico que a atende) |
| POST | `/api/appointments/{id}/confirm` | Confirma um pedido pendente e avisa o paciente (médico que a atende) |
| POST | `/api/appointments/{id}/complete`, `/no-show` | Conclui ou registra falta em uma consulta confirmada que já começou (médico que a atende) |
| POST | `/api/appointments/{id}/cancel` | Cancela a consulta e avisa a outra parte; motivo obrigatório para o médico (paciente dela ou médico que a atende) |
| POST | `/api/appointments/{id}/reschedule` | Troca o horário dentro da política de reagendamento; volta a pendente e avisa o médico (paciente dela) |
| GET | `/api/exam-availability` | Vagas de um exame na unidade entre `from` e `to`, até 31 dias, com os lugares restantes; `rescheduling` libera o lugar do próprio exame na tela de reagendar (paciente) |
| POST | `/api/exam-bookings` | Agenda um exame em uma vaga com lugar; nasce confirmado, com código público (paciente) |
| GET | `/api/exam-bookings/{id}` | Detalhe, preparo e histórico do exame (paciente dele) |
| POST | `/api/exam-bookings/{id}/cancel` | Cancela o exame e libera o lugar (paciente dele) |
| POST | `/api/exam-bookings/{id}/reschedule` | Troca o horário dentro da política de reagendamento; continua confirmado, sujeito à capacidade (paciente dele) |
| GET | `/api/patient/home` | Próximos agendamentos, totais das abas e último aviso (paciente) |
| GET | `/api/patient/bookings` | Agendamentos do paciente por aba `scope`, com filtros `kind` e `status` e ações permitidas (paciente) |
| GET, POST | `/api/admin/specialties` | Lista e cria especialidades (admin) |
| PATCH | `/api/admin/specialties/{id}` | Altera, ativa ou desativa uma especialidade (admin) |
| GET, POST | `/api/admin/units` | Lista e cria unidades com horários (admin) |
| PATCH | `/api/admin/units/{id}` | Altera, ativa ou desativa uma unidade (admin) |
| GET, POST | `/api/admin/exam-types` | Lista e cria tipos de exame (admin) |
| PATCH | `/api/admin/exam-types/{id}` | Altera, ativa ou desativa um tipo de exame (admin) |
| GET | `/api/admin/units/{id}/exam-offers` | Exames oferecidos pela unidade (admin) |
| PUT | `/api/admin/units/{id}/exam-offers/{examTypeId}` | Oferece um exame na unidade (admin) |
| GET, PUT | `/api/admin/policy` | Política de agendamento (admin) |
| GET, POST | `/api/admin/integration-clients` | Lista as integrações e cria uma, com a chave exibida uma única vez (admin) |
| POST | `/api/admin/integration-clients/{id}/revoke` | Revoga a chave de uma integração (admin) |
| GET | `/api/integrations/lab/worklist` | Exames do dia `date` que aguardam resultado, só com os códigos (chave de API) |
| POST | `/api/integrations/lab/results` | Publica ou retifica o resultado de um exame (chave de API) |
| GET | `/api/admin/home` | Números do painel do administrador, com as consultas de hoje |
| GET | `/api/admin/reports` | Totais de consultas e exames por situação no período `from`–`to` (padrão: últimos 30 dias; máximo 366), com série diária ou semanal (admin) |
| GET | `/api/admin/users` | Lista e busca usuários (admin) |
| GET, PATCH | `/api/admin/users/{id}` | Vê e altera nome e telefone (admin) |
| GET | `/api/admin/users/{id}/deactivation-impact` | Agendamentos afetados por desativar (admin) |
| POST | `/api/admin/users/{id}/deactivate`, `/reactivate` | Desativa e reativa a conta (admin) |
| POST | `/api/admin/users/{id}/password-reset` | Envia link de redefinição de senha (admin) |
| POST, DELETE | `/api/admin/users/{id}/roles/admin` | Concede e remove o perfil de administrador (admin) |
| POST, PATCH, DELETE | `/api/admin/users/{id}/doctor-profile` | Cria, altera e remove o perfil médico (admin) |
| GET, PUT | `/api/doctor/schedule` | Agenda semanal do médico, em minutos desde 00:00 (médico) |
| GET | `/api/doctor/home` | Resumo de hoje, próximos pedidos a confirmar, totais das abas e último aviso (médico) |
| GET | `/api/doctor/appointments` | Consultas do médico por aba `tab`, a partir do dia `from`, com o paciente e as ações permitidas (médico) |
| GET | `/api/notifications` | Avisos da conta no perfil `role`, do mais novo para o mais antigo |
| GET | `/api/notifications/unread-count` | Total de avisos não lidos no perfil `role`, servido da memória |
| POST | `/api/notifications/{id}/read` | Marca um aviso como lido |
| POST | `/api/notifications/read-all` | Marca como lidos todos os avisos do perfil `role` |
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
