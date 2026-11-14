export const apiDescription = `
API do **Saúde+**, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador.

As rotas de negócio ficam sob \`/api\`. Nesta versão existem o cadastro, o login, o logout, a redefinição de senha, o perfil da própria conta, o catálogo com a administração dele, a administração de usuários, a agenda semanal do médico, a lista de médicos com as vagas livres de cada um, o pedido de consulta com o detalhe dela e as notificações, além de \`/health\` e desta documentação. Cada rota lista o que realmente pode devolver.

## Erros

Toda resposta de erro tem o mesmo formato:

\`\`\`json
{
  "message": "Dados inválidos.",
  "code": "VALIDATION_ERROR",
  "fields": { "email": "E-mail inválido." }
}
\`\`\`

- \`message\` é um texto em português, pronto para exibir.
- \`code\` é estável e serve para o cliente decidir o que fazer ou escolher o próprio texto.
- \`fields\` aparece em erros de validação e nos de regra ligados a um campo, com uma mensagem por campo.

| Status | Quando acontece |
|---|---|
| \`400\` | Corpo, parâmetros ou JSON inválidos |
| \`401\` | Sem sessão, sessão expirada ou credenciais incorretas |
| \`403\` | Conta desativada, sem o perfil exigido ou de demonstração |
| \`404\` | Rota, método ou registro inexistente |
| \`409\` | Conflito com o estado atual, como e-mail já cadastrado |
| \`422\` | Regra de negócio não atendida, como senha atual incorreta |
| \`413\` | Corpo maior que 100 KB |
| \`415\` | Charset ou codificação do corpo não suportados |
| \`429\` | Limite de tentativas atingido; o cabeçalho \`RateLimit\` diz quando tentar de novo |
| \`500\` | Erro interno; os detalhes ficam só nos logs |
| \`503\` | Servidor ocupado conferindo senhas; tente de novo em instantes |

Um agendamento de outra pessoa responde \`404\`, como se não existisse, e um horário já ocupado responde \`409\`.

## Códigos de erro

Códigos comuns a todas as rotas. Cada rota lista também os códigos específicos dela.

| Código | Status | Significado |
|---|---|---|
| \`VALIDATION_ERROR\` | 400 | Algum campo não passou na validação; veja \`fields\` |
| \`INVALID_JSON\` | 400 | O corpo não é um JSON válido ou não é um objeto ou array |
| \`BAD_REQUEST\` | 400 ou 415 | Requisição malformada, como parâmetro de URL inválido, charset ou codificação não suportados |
| \`UNAUTHENTICATED\` | 401 | Rota exige login e o token falta, é inválido ou expirou |
| \`FORBIDDEN\` | 403 | A conta não tem o perfil exigido pela rota |
| \`INVALID_RESET_TOKEN\` | 400 | Link de redefinição de senha inválido, usado ou vencido |
| \`INVALID_CURRENT_PASSWORD\` | 422 | A senha atual informada na troca de senha está errada |
| \`PROTECTED_ACCOUNT\` | 403 | Contas de demonstração não podem ser alteradas |
| \`NOT_FOUND\` | 404 | O registro pedido não existe |
| \`NAME_TAKEN\` | 409 | Já existe um cadastro com esse nome, sem distinguir maiúsculas |
| \`CODE_TAKEN\` | 409 | Já existe um tipo de exame com esse código |
| \`EXAM_TYPE_INACTIVE\` | 409 | O tipo de exame está inativo e não pode ter oferta ativa |
| \`COUNCIL_IN_USE\` | 409 | A especialidade tem médicos; o conselho não pode mudar |
| \`SELF_OR_LAST_ADMIN\` | 409 | O administrador não pode desativar nem rebaixar a si mesmo nem deixar o sistema sem administradores |
| \`USER_INACTIVE\` | 403 ou 409 | Conta desativada: login recusado (403) ou ação que exige conta ativa (409) |
| \`REGISTRY_TAKEN\` | 409 | O registro profissional já pertence a outro médico |
| \`DOCTOR_PROFILE_EXISTS\` | 409 | A conta já tem perfil médico |
| \`HAS_FUTURE_APPOINTMENTS\` | 409 | O médico tem consultas futuras que impedem a mudança |
| \`RESET_NOT_SENT\` | 409 | Um link de redefinição foi enviado há pouco ou o limite do dia foi atingido |
| \`SLOT_TAKEN\` | 409 | O horário escolhido acabou de ser ocupado na agenda do médico |
| \`PATIENT_CONFLICT\` | 409 | O paciente já tem um agendamento ativo que coincide com o horário |
| \`SPECIALTY_UNAVAILABLE\`, \`UNIT_UNAVAILABLE\` | 422 | A especialidade ou a unidade escolhida está inativa ou não existe |
| \`OVERLAP\` | 422 | Faixas de horário do mesmo dia se sobrepõem; veja \`fields\` |
| \`OUTSIDE_UNIT_HOURS\` | 422 | A faixa de horário fica fora do horário da unidade; veja \`fields\` |
| \`OUTSIDE_AVAILABILITY\` | 422 | O horário não é uma vaga gerada pela agenda do médico |
| \`ACTIVE_LIMIT\` | 422 | O paciente já tem 5 agendamentos ativos futuros |
| \`SPECIALTY_MISMATCH\` | 422 | O médico escolhido não atende a especialidade escolhida |
| \`SELF_BOOKING\` | 422 | O médico tentou marcar consulta consigo mesmo |
| \`ROUTE_NOT_FOUND\` | 404 | A rota ou o método não existe |
| \`PAYLOAD_TOO_LARGE\` | 413 | O corpo passou de 100 KB |
| \`TOO_MANY_REQUESTS\` | 429 | Muitas requisições do mesmo IP (300 por minuto) ou limite próprio da rota |
| \`INTERNAL_ERROR\` | 500 | Erro inesperado no servidor |
| \`SERVER_BUSY\` | 503 | Muitas senhas sendo conferidas ao mesmo tempo |

## Autenticação

Crie uma conta em \`POST /api/users/register\` e entre em \`POST /api/users/login\` para receber o token. As rotas que exigem login mostram um cadeado e recebem o token no cabeçalho:

\`\`\`http
Authorization: Bearer <token>
\`\`\`

Sem "Lembrar de mim", a sessão expira após 12 horas sem uso; com ele, dura 7 dias. Nenhuma sessão passa de 7 dias, e \`POST /api/users/logout\` encerra a sessão na hora. Quando a sessão não vale mais, a rota responde \`401\` com \`UNAUTHENTICATED\`.

O botão **Authorize** desta página envia o token em todas as chamadas de teste. Fora de produção, o token fica salvo neste navegador até você clicar em **Logout**.

## Conta de demonstração

Para testar sem criar conta, entre com uma das contas de demonstração. As credenciais são públicas e servem só para demonstração:

- Paciente: \`paciente@saudemais.test\`, senha \`paciente-demo-123\`.
- Médico, que também é paciente e passa pela escolha de perfil: \`medico@saudemais.test\`, senha \`medico-demo-123\`.

Os dados delas são de exemplo, e elas não podem ser alteradas nem desativadas. Esses e-mails não podem ser usados em um cadastro novo.

## Datas

- Data e hora, como o início de uma vaga, em ISO 8601 e UTC: \`2026-11-20T13:30:00.000Z\`.
- Datas sem horário, como \`from\` e \`to\` das vagas, em \`YYYY-MM-DD\`, no fuso de São Paulo (\`America/Sao_Paulo\`).
- Para agendar, envie de volta o \`startsAt\` recebido na lista de vagas, sem montar o horário no cliente.

## Paginação

As listas paginadas recebem \`page\` (a partir de 1) e \`pageSize\` (até 50) e respondem:

\`\`\`json
{ "items": [], "page": 1, "pageSize": 20, "total": 0 }
\`\`\`
`.trim();
