import type { NoteTemplate } from '../../shared/types';

export const DEFAULT_TEMPLATE_ID = 'reuniao-geral';

/** Ícone dos templates do usuário. */
export const USER_TEMPLATE_ICON = 'file-text';

export const BUILTIN_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: DEFAULT_TEMPLATE_ID,
    title: 'Reunião geral',
    description: 'Reunião de trabalho em geral, sem um formato específico.',
    icon: 'file-text',
    builtin: true,
    sections: [
      { heading: 'Resumo', description: '3 a 6 frases sobre o que foi discutido.' },
      { heading: 'Decisões', description: 'Lista do que foi decidido.' },
      { heading: 'Próximas ações', description: 'Checklist "- [ ] ação — responsável", com responsável só quando estiver claro.' },
      { heading: 'Pontos em aberto', description: 'Perguntas ou temas que ficaram sem conclusão.' },
    ],
  },
  {
    id: 'um-a-um',
    title: '1:1',
    description: 'Conversa individual entre duas pessoas, como gestor e liderado.',
    icon: 'users',
    builtin: true,
    sections: [
      { heading: 'Como a pessoa está', description: 'Humor, energia e o que ela trouxe de pessoal ou de contexto do momento.' },
      { heading: 'Progresso', description: 'O que andou desde a última conversa e conquistas citadas.' },
      { heading: 'Bloqueios', description: 'Obstáculos, dúvidas e onde a pessoa precisa de ajuda.' },
      { heading: 'Feedback', description: 'Feedbacks dados e recebidos, com exemplos concretos quando houver.' },
      { heading: 'Próximos passos', description: 'Checklist "- [ ] ação — responsável" combinado entre os dois.' },
    ],
  },
  {
    id: 'daily',
    title: 'Daily / Stand-up',
    description: 'Reunião rápida de alinhamento diário do time.',
    icon: 'sun',
    builtin: true,
    sections: [
      { heading: 'Ontem', description: 'O que cada pessoa fez desde a última daily, agrupado por pessoa.' },
      { heading: 'Hoje', description: 'O que cada pessoa pretende fazer hoje, agrupado por pessoa.' },
      { heading: 'Bloqueios', description: 'Impedimentos citados, quem está bloqueado e quem pode ajudar.' },
    ],
  },
  {
    id: 'entrevista-candidato',
    title: 'Entrevista de candidato',
    description: 'Entrevista com uma pessoa candidata a uma vaga.',
    icon: 'user-check',
    builtin: true,
    sections: [
      { heading: 'Perfil', description: 'Quem é a pessoa, momento de carreira e o que busca.' },
      { heading: 'Experiência relevante', description: 'Trabalhos, projetos e resultados citados que importam para a vaga.' },
      { heading: 'Pontos fortes', description: 'Habilidades e comportamentos que se destacaram, com exemplos da conversa.' },
      { heading: 'Pontos de atenção', description: 'Dúvidas, lacunas ou sinais de alerta que merecem aprofundar.' },
      { heading: 'Recomendação', description: 'Avaliação final apoiada só no que foi dito; deixe claro se faltou informação para concluir.' },
    ],
  },
  {
    id: 'cliente-vendas',
    title: 'Reunião com cliente / vendas',
    description: 'Conversa com cliente ou prospect, de descoberta, demonstração ou negociação.',
    icon: 'briefcase',
    builtin: true,
    sections: [
      { heading: 'Contexto do cliente', description: 'Empresa, time, situação atual e quem participou.' },
      { heading: 'Dores', description: 'Problemas e necessidades que o cliente descreveu, com as palavras dele quando possível.' },
      { heading: 'Requisitos', description: 'O que o cliente precisa que a solução faça, prazos e orçamento mencionados.' },
      { heading: 'Objeções', description: 'Dúvidas, resistências e concorrentes citados, e como foram respondidos.' },
      { heading: 'Próximos passos', description: 'Checklist "- [ ] ação — responsável" com datas combinadas.' },
    ],
  },
  {
    id: 'brainstorm',
    title: 'Brainstorm',
    description: 'Sessão de geração e priorização de ideias.',
    icon: 'lightbulb',
    builtin: true,
    sections: [
      { heading: 'Ideias', description: 'Todas as ideias levantadas, em lista, sem julgamento.' },
      { heading: 'Ideias mais promissoras', description: 'As que o grupo destacou ou priorizou, e por quê.' },
      { heading: 'Riscos', description: 'Preocupações, dependências e incertezas levantadas sobre as ideias.' },
      { heading: 'Próximos passos', description: 'Checklist "- [ ] ação — responsável" para testar ou avançar as ideias.' },
    ],
  },
];

export type TemplateTexts = { title: string; description: string; sections: Array<{ heading: string; description: string }> };

/** Versão em inglês dos embutidos (mesmo id, mesma ordem e quantidade de seções). */
export const BUILTIN_TEMPLATES_EN: Record<string, TemplateTexts> = {
  'reuniao-geral': {
    title: 'General meeting',
    description: 'A work meeting with no specific format.',
    sections: [
      { heading: 'Summary', description: '3 to 6 sentences on what was discussed.' },
      { heading: 'Decisions', description: 'List of what was decided.' },
      { heading: 'Next actions', description: 'Checklist "- [ ] action — owner", with the owner only when it is clear.' },
      { heading: 'Open points', description: 'Questions or topics left without a conclusion.' },
    ],
  },
  'um-a-um': {
    title: '1:1',
    description: 'A one-on-one conversation, such as manager and report.',
    sections: [
      { heading: 'How the person is doing', description: 'Mood, energy and any personal or situational context they brought.' },
      { heading: 'Progress', description: 'What moved since the last conversation and achievements mentioned.' },
      { heading: 'Blockers', description: 'Obstacles, doubts and where the person needs help.' },
      { heading: 'Feedback', description: 'Feedback given and received, with concrete examples when there are any.' },
      { heading: 'Next steps', description: 'Checklist "- [ ] action — owner" agreed between the two.' },
    ],
  },
  daily: {
    title: 'Daily / Stand-up',
    description: 'A quick daily alignment meeting for the team.',
    sections: [
      { heading: 'Yesterday', description: 'What each person did since the last daily, grouped by person.' },
      { heading: 'Today', description: 'What each person plans to do today, grouped by person.' },
      { heading: 'Blockers', description: 'Impediments mentioned, who is blocked and who can help.' },
    ],
  },
  'entrevista-candidato': {
    title: 'Candidate interview',
    description: 'An interview with a candidate for a position.',
    sections: [
      { heading: 'Profile', description: 'Who the person is, career stage and what they are looking for.' },
      { heading: 'Relevant experience', description: 'Jobs, projects and results mentioned that matter for the position.' },
      { heading: 'Strengths', description: 'Skills and behaviors that stood out, with examples from the conversation.' },
      { heading: 'Points of attention', description: 'Doubts, gaps or red flags worth digging into.' },
      { heading: 'Recommendation', description: 'Final assessment based only on what was said; make clear if information was missing to conclude.' },
    ],
  },
  'cliente-vendas': {
    title: 'Customer / sales meeting',
    description: 'A conversation with a customer or prospect: discovery, demo or negotiation.',
    sections: [
      { heading: 'Customer context', description: 'Company, team, current situation and who took part.' },
      { heading: 'Pain points', description: 'Problems and needs the customer described, in their own words when possible.' },
      { heading: 'Requirements', description: 'What the customer needs the solution to do, plus deadlines and budget mentioned.' },
      { heading: 'Objections', description: 'Doubts, resistance and competitors mentioned, and how they were answered.' },
      { heading: 'Next steps', description: 'Checklist "- [ ] action — owner" with the agreed dates.' },
    ],
  },
  brainstorm: {
    title: 'Brainstorm',
    description: 'A session to generate and prioritize ideas.',
    sections: [
      { heading: 'Ideas', description: 'All the ideas raised, as a list, without judgment.' },
      { heading: 'Most promising ideas', description: 'The ones the group highlighted or prioritized, and why.' },
      { heading: 'Risks', description: 'Concerns, dependencies and uncertainties raised about the ideas.' },
      { heading: 'Next steps', description: 'Checklist "- [ ] action — owner" to test or advance the ideas.' },
    ],
  },
};

/**
 * Template no idioma pedido. Só o embutido ainda não editado muda de idioma;
 * o template do usuário e o override de um embutido valem exatamente como foram escritos.
 */
export function localizeTemplate(template: NoteTemplate, language: 'pt-BR' | 'en'): NoteTemplate {
  const en = BUILTIN_TEMPLATES_EN[template.id];
  if (language !== 'en' || !template.builtin || template.customized || !en) return template;
  return { ...template, title: en.title, description: en.description, sections: en.sections.map((s) => ({ ...s })) };
}
