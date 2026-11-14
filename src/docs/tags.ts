export const tags = {
  system: {
    name: 'Sistema',
    description: 'Estado do servidor. Não exige login e não consulta o banco.',
  },
  accounts: {
    name: 'Contas',
    description: 'Cadastro, login e logout. A sessão é um token opaco enviado em `Authorization: Bearer <token>`.',
  },
  profile: { name: 'Perfil', description: 'Dados, senha e sessões da própria conta. Exige login.' },
  catalog: {
    name: 'Catálogo',
    description: 'Especialidades, unidades e tipos de exame ativos, usados nos agendamentos. Exige login.',
  },
  scheduling: {
    name: 'Agendamento',
    description: 'Médicos e vagas livres para o paciente marcar consulta. Exige o perfil de paciente.',
  },
  doctor: {
    name: 'Médico',
    description: 'Agenda e rotina do médico logado. Exige o perfil de médico.',
  },
  administration: {
    name: 'Administração',
    description:
      'Usuários, papéis e perfis médicos; cadastro de especialidades, unidades, horários, exames, ofertas e da política de agendamento. Só administradores.',
  },
} as const;

export const tagList = Object.values(tags);
