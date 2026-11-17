const glossary: Record<string, string> = {
  hemacias: 'São os glóbulos vermelhos. Levam o oxigênio dos pulmões para o resto do corpo.',
  eritrocitos: 'São os glóbulos vermelhos. Levam o oxigênio dos pulmões para o resto do corpo.',
  hemoglobina:
    'Proteína dentro dos glóbulos vermelhos que carrega o oxigênio. Quando está baixa, pode indicar anemia.',
  hematocrito:
    'Mostra quanto do volume do sangue é formado por glóbulos vermelhos. Ajuda a avaliar anemia e hidratação.',
  vcm: 'Volume corpuscular médio: o tamanho médio dos glóbulos vermelhos.',
  hcm: 'Hemoglobina corpuscular média: quanto de hemoglobina há, em média, em cada glóbulo vermelho.',
  chcm: 'Concentração de hemoglobina dentro dos glóbulos vermelhos.',
  rdw: 'Mostra se os glóbulos vermelhos têm tamanhos parecidos ou muito diferentes entre si.',
  leucocitos: 'São os glóbulos brancos, as células de defesa do corpo. Costumam subir em infecções e inflamações.',
  neutrofilos: 'Glóbulos brancos que combatem principalmente infecções por bactérias.',
  linfocitos: 'Glóbulos brancos ligados à defesa contra vírus e à memória do sistema imune.',
  monocitos: 'Glóbulos brancos que limpam células mortas e ajudam a combater infecções.',
  eosinofilos: 'Glóbulos brancos que aumentam em alergias e em algumas infecções por parasitas.',
  basofilos: 'Glóbulos brancos raros, ligados a reações alérgicas e inflamatórias.',
  plaquetas: 'Pedacinhos de células que ajudam o sangue a coagular e a fechar ferimentos.',
  vpm: 'Volume plaquetário médio: o tamanho médio das plaquetas.',
  'glicose em jejum': 'Quantidade de açúcar no sangue depois de algumas horas sem comer. Ajuda a avaliar o diabetes.',
  glicose: 'Quantidade de açúcar no sangue. Ajuda a avaliar o diabetes.',
  'hemoglobina glicada': 'Mostra a média do açúcar no sangue nos últimos 2 a 3 meses.',
  'colesterol total': 'Soma das gorduras de colesterol no sangue. Em excesso, aumenta o risco para o coração.',
  hdl: 'O chamado colesterol bom, que ajuda a retirar o excesso de gordura dos vasos.',
  ldl: 'O chamado colesterol ruim. Em excesso, se acumula nas paredes dos vasos.',
  triglicerideos: 'Tipo de gordura no sangue que sobe com açúcar, álcool e alimentação gordurosa.',
  creatinina: 'Resíduo dos músculos eliminado pelos rins. Ajuda a avaliar como os rins estão funcionando.',
  ureia: 'Resíduo das proteínas eliminado pelos rins. Também ajuda a avaliar os rins.',
  tsh: 'Hormônio que controla a tireoide. Alterado, pode indicar tireoide lenta ou acelerada.',
  't4 livre': 'Hormônio produzido pela tireoide, que regula o metabolismo do corpo.',
};

const keyOf = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function aboutItem(name: string): string | null {
  return glossary[keyOf(name)] ?? null;
}
