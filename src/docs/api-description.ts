export const apiDescription = `
API do **Saúde+**, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador.

As rotas de negócio ficarão sob \`/api\`. Nesta versão existem apenas \`/health\` e esta documentação. As seções marcadas como convenção descrevem o padrão que as próximas rotas vão seguir; cada rota lista o que realmente pode devolver.

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
| \`404\` | Rota ou método inexistente |
| \`413\` | Corpo maior que 100 KB |
| \`415\` | Charset ou codificação do corpo não suportados |
| \`500\` | Erro interno; os detalhes ficam só nos logs |

Convenção para as próximas rotas: \`401\` sem sessão ou com sessão expirada, \`403\` sem o perfil exigido, \`404\` também para recurso inexistente ou de outra pessoa, \`409\` para conflito com o estado atual (como horário já ocupado) e \`422\` para regra de negócio não atendida.

## Códigos de erro

Códigos comuns a todas as rotas. Cada rota lista também os códigos específicos dela.

| Código | Status | Significado |
|---|---|---|
| \`VALIDATION_ERROR\` | 400 | Algum campo não passou na validação; veja \`fields\` |
| \`INVALID_JSON\` | 400 | O corpo não é um JSON válido ou não é um objeto ou array |
| \`BAD_REQUEST\` | 400 ou 415 | Requisição malformada, como parâmetro de URL inválido, charset ou codificação não suportados |
| \`ROUTE_NOT_FOUND\` | 404 | A rota ou o método não existe |
| \`PAYLOAD_TOO_LARGE\` | 413 | O corpo passou de 100 KB |
| \`INTERNAL_ERROR\` | 500 | Erro inesperado no servidor |

## Autenticação

Convenção para as próximas rotas: as que exigem login mostrarão um cadeado e recebem o token de sessão no cabeçalho:

\`\`\`http
Authorization: Bearer <token>
\`\`\`

O botão **Authorize** desta página envia o token em todas as chamadas de teste. Fora de produção, o token fica salvo neste navegador até você clicar em **Logout**.

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
