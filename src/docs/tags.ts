export const tags = {
  system: {
    name: 'Sistema',
    description: 'Estado do servidor. Não exige login e não consulta o banco.',
  },
  accounts: {
    name: 'Contas',
    description: 'Cadastro, login e logout. A sessão é um token opaco enviado em `Authorization: Bearer <token>`.',
  },
} as const;

export const tagList = Object.values(tags);
