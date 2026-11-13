export const tags = {
  system: { name: 'Sistema', description: 'Estado do servidor. Não exige login e não consulta o banco.' },
} as const;

export const tagList = Object.values(tags);
