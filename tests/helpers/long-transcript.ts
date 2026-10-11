import { formatClock } from '../../src/shared/naming';

/** Transcrição sintética no formato do Rice: uma fala a cada ~6 s, ~14 palavras, alternando Eu/Outros. */
export function syntheticTranscript(opts: { minutes: number; startedAt: Date; title?: string }): { text: string; words: number; lines: number } {
  const topics = ['orçamento', 'contratação', 'roadmap', 'segurança', 'migração', 'clientes', 'métricas', 'treinamento'];
  const out = [`# Transcrição — ${opts.title ?? 'Planejamento'}\n`];
  let words = 0;
  const total = Math.floor((opts.minutes * 60) / 6);
  for (let i = 0; i < total; i++) {
    const at = new Date(opts.startedAt.getTime() + i * 6000);
    const topic = topics[Math.floor(i / (150)) % topics.length]!; // muda a cada 15 min
    const text = `no item ${i} sobre ${topic} precisamos alinhar o prazo com o time e confirmar quem`;
    words += text.split(' ').length;
    out.push(`**[${formatClock(at)}] ${i % 2 === 0 ? 'Outros' : 'Eu'}:** ${text}\n`);
  }
  return { text: out.join('\n') + '\n', words, lines: total };
}
