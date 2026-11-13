export const apiDescription = `
API do **Saúde+**, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador.

Todas as rotas da aplicação ficam sob \`/api\`. As exceções são \`/health\` e esta documentação.

## Autenticação

Rotas que exigem login mostram um cadeado. Envie o token de sessão recebido no login no cabeçalho:

\`\`\`http
Authorization: Bearer <token>
\`\`\`

Use o botão **Authorize** desta página para enviar o token em todas as chamadas de teste. Sessões expiradas ou revogadas respondem \`401\`.

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
- \`fields\` só aparece em erros de validação e traz uma mensagem por campo.

| Status | Quando acontece |
|---|---|
| \`400\` | Corpo, parâmetros ou JSON inválidos |
| \`401\` | Sem sessão ou sessão expirada |
| \`403\` | Sem o perfil exigido pela rota |
| \`404\` | Recurso inexistente ou de outra pessoa |
| \`409\` | Conflito com o estado atual, como horário já ocupado |
| \`413\` | Corpo maior que 100 kB |
| \`422\` | Regra de negócio não atendida |
| \`429\` | Limite de requisições atingido |
| \`500\` | Erro interno; os detalhes ficam só nos logs |

## Códigos de erro

Códigos comuns a todas as rotas. Cada rota lista também os códigos específicos dela.

| Código | Status | Significado |
|---|---|---|
| \`VALIDATION_ERROR\` | 400 | Algum campo não passou na validação; veja \`fields\` |
| \`INVALID_JSON\` | 400 | O corpo não é um JSON válido |
| \`BAD_REQUEST\` | 400 | Requisição malformada, como parâmetro de URL inválido |
| \`ROUTE_NOT_FOUND\` | 404 | A rota não existe |
| \`PAYLOAD_TOO_LARGE\` | 413 | O corpo passou de 100 kB |
| \`INTERNAL_ERROR\` | 500 | Erro inesperado no servidor |

## Datas

- Instantes, como o início de uma consulta, usam ISO 8601 em UTC: \`2026-11-20T13:30:00.000Z\`.
- Datas sem horário, como um filtro por dia, usam \`YYYY-MM-DD\` e se referem ao dia civil de São Paulo.

## Paginação

Listas recebem \`page\` (a partir de 1) e \`pageSize\` (até 50) e respondem:

\`\`\`json
{ "items": [], "page": 1, "pageSize": 20, "total": 0 }
\`\`\`
`.trim();
