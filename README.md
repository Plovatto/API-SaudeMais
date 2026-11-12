# Saúde+ API

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

API do Saúde+, sistema de agendamento de consultas e exames com três perfis: paciente, médico e administrador. Desenvolvida com Node.js, TypeScript e Express.

> Projeto em desenvolvimento. O andamento está no [quadro do projeto](https://github.com/users/Plovatto/projects/2).

**Front-end:** [Plovatto/SaudeMais](https://github.com/Plovatto/SaudeMais)

## Funcionalidades

- Configuração centralizada e validada por variáveis de ambiente
- Respostas de erro padronizadas no formato `{ message, code, fields? }`
- Cabeçalhos de segurança com Helmet e CORS restrito à origem do front
- Logging estruturado com dados sensíveis ocultados
- Testes automatizados com Vitest

## Tecnologias

- [Node.js](https://nodejs.org/) 22.12+ (24 LTS recomendado)
- [TypeScript](https://www.typescriptlang.org/)
- [Express](https://expressjs.com/)
- [Zod](https://zod.dev/) - validação de requisições e variáveis de ambiente
- [Helmet](https://helmetjs.github.io/) e [cors](https://github.com/expressjs/cors) - segurança HTTP
- [Pino](https://getpino.io/) - logging estruturado
- [Vitest](https://vitest.dev/) e [Supertest](https://github.com/ladjs/supertest) - testes automatizados
- ESLint - análise e padronização do código

## Como Executar

### Pré-requisitos

- [Node.js](https://nodejs.org/) 22.12 ou superior
- npm

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
```

`CORS_ORIGIN` é a origem do front (esquema, domínio e porta, sem caminho) e é obrigatória em produção.

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

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Verifica se o servidor está no ar |

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
