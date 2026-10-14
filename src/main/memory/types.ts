/** Memória entre reuniões: o que cada pessoa e empresa pediu, prometeu e decidiu. Só local (`<raiz>/.rice/memory.jsonl`). */
export const FACT_KINDS = ['commitment', 'request', 'decision', 'open_question', 'preference', 'context'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export type FactStatus = 'open' | 'done' | 'superseded';

export type FactSource = { dir: string; title: string; date: string; at?: string };

export type Fact = {
  id: string;
  kind: FactKind;
  /** Pessoa a quem o fato se refere ("Eu" = o próprio usuário). */
  who: string;
  org?: string;
  about: string;
  text: string;
  /** Prazo, AAAA-MM-DD (só quando a conversa deu uma data clara). */
  due?: string;
  confidence: number;
  source: FactSource;
  status: FactStatus;
  updatedAt: string;
  /** Pendência minha (eu prometi, ou pediram a mim) ou dos outros (prometeram a mim). */
  mine: boolean;
  /** Criada à mão pelo usuário. */
  manual?: boolean;
  /** O usuário editou o texto: uma nova extração da mesma reunião não a apaga. */
  edited?: boolean;
  /** Fechada: pela IA numa reunião seguinte (`dir`) ou à mão. */
  doneBy?: { dir: string; title: string; date: string } | { manual: true };
  doneAt?: string;
};

/** O que uma extração devolve antes de virar `Fact` (já validado). */
export type RawFact = { kind: FactKind; who: string; org?: string; about: string; text: string; due?: string; confidence: number };

/** Pendência = compromisso ou pedido (aberto ou feito). */
export const isFollowup = (f: Fact): boolean => (f.kind === 'commitment' || f.kind === 'request') && f.status !== 'superseded';
