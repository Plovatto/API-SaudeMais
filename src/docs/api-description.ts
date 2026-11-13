export const apiDescription = `
API do **Saúde+**, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador.

As rotas de negócio ficam sob \`/api\`. Nesta versão existem o cadastro, o login, o logout, a redefinição de senha e o perfil da própria conta, além de \`/health\` e desta documentação. As seções marcadas como convenção descrevem o padrão que as próximas rotas vão seguir; cada rota lista o que realmente pode devolver.

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
- \`fields\` aparece apenas em erros de validação, com uma mensagem por campo.

| Status | Quando acontece |
|---|---|
| \`400\` | Corpo, parâmetros ou JSON inválidos |
| \`401\` | Sem sessão, sessão expirada ou credenciais incorretas |
| \`403\` | Conta desativada, sem o perfil exigido ou de demonstração |
| \`404\` | Rota ou método inexistente |
| \`409\` | Conflito com o estado atual, como e-mail já cadastrado |
| \`422\` | Regra de negócio não atendida, como senha atual incorreta |
| \`413\` | Corpo maior que 100 KB |
| \`415\` | Charset ou codificação do corpo não suportados |
| \`429\` | Limite de tentativas atingido; o cabeçalho \`RateLimit\` diz quando tentar de novo |
| \`500\` | Erro interno; os detalhes ficam só nos logs |
| \`503\` | Servidor ocupado conferindo senhas; tente de novo em instantes |

Convenção para as próximas rotas: \`404\` também para recurso inexistente ou de outra pessoa e \`409\` também para horário já ocupado.

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

Para testar sem criar conta, entre com o paciente de demonstração: \`paciente@saudemais.test\`, senha \`paciente-demo-123\`. Os dados dele são de exemplo e ele não pode ser alterado nem desativado.

## Datas

Convenção para as próximas rotas:

- Data e hora, como o início de uma consulta, em ISO 8601 e UTC: \`2026-11-20T13:30:00.000Z\`.
- Datas sem horário, como um filtro por dia, em \`YYYY-MM-DD\`, no fuso de São Paulo (\`America/Sao_Paulo\`).

## Paginação

Convenção para as próximas rotas: listas recebem \`page\` (a partir de 1) e \`pageSize\` (até 50) e respondem:

\`\`\`json
{ "items": [], "page": 1, "pageSize": 20, "total": 0 }
\`\`\`
`.trim();
