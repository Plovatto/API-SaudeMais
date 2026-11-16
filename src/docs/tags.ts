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
    description:
      'Médicos, vagas livres, pedidos de consulta, agendamento de exames e cancelamento. Exige o perfil de paciente; o detalhe e o cancelamento de uma consulta também abrem para o médico que a atende.',
  },
  patient: {
    name: 'Paciente',
    description: 'Início e agendamentos do paciente logado. Exige o perfil de paciente.',
  },
  doctor: {
    name: 'Médico',
    description: 'Agenda e rotina do médico logado. Exige o perfil de médico.',
  },
  notifications: {
    name: 'Notificações',
    description:
      'Avisos da conta logada, separados pelo perfil da área aberta (`role`). O cliente monta o texto a partir de `type` e `params`. Exige login.',
  },
  administration: {
    name: 'Administração',
    description:
      'Usuários, papéis e perfis médicos; cadastro de especialidades, unidades, horários, exames, ofertas e da política de agendamento. Só administradores.',
  },
  integrations: {
    name: 'Integrações',
    description:
      'Rotas do laboratório parceiro, autenticadas pela chave de API no cabeçalho `X-Api-Key`: lista de exames que aguardam resultado e publicação de resultados. Não usam sessão nem devolvem dados pessoais.',
  },
} as const;

export const tagList = Object.values(tags);
