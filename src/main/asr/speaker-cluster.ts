/**
 * Clustering online dos embeddings de voz do canal do sistema ("Outros"): cada trecho vira "Pessoa N".
 * Limiares medidos com o 3D-Speaker CAM++ (ver .superpowers/notes-magic-report.md): mesma voz fica entre 0,56 e 0,95
 * de similaridade de cosseno (trechos de 1 s a inteiros), vozes diferentes até 0,52 (banda telefônica com ruído).
 */
export type ClusterOptions = {
  /** Similaridade mínima para entrar num grupo existente. */
  threshold?: number;
  /** Só trechos com pelo menos isto (ms) criam um grupo novo ou refinam o centroide; os curtos só herdam. */
  minReliableMs?: number;
  maxSpeakers?: number;
};

export type ClusterState = { clusters: Array<{ id: number; n: number; sum: number[] }>; last: number | null };

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_MIN_RELIABLE_MS = 1200;
const DEFAULT_MAX_SPEAKERS = 10;

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export class OnlineSpeakerClusterer {
  private readonly threshold: number;
  private readonly minReliableMs: number;
  private readonly maxSpeakers: number;
  private clusters: ClusterState['clusters'] = [];
  private last: number | null = null;

  constructor(options: ClusterOptions = {}, state?: ClusterState) {
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
    this.minReliableMs = options.minReliableMs ?? DEFAULT_MIN_RELIABLE_MS;
    this.maxSpeakers = options.maxSpeakers ?? DEFAULT_MAX_SPEAKERS;
    if (state) {
      this.clusters = state.clusters.map((c) => ({ ...c, sum: [...c.sum] }));
      this.last = state.last;
    }
  }

  /** Quem falou por último (ou `null`). */
  get lastSpeaker(): number | null {
    return this.last;
  }

  get speakerCount(): number {
    return this.clusters.length;
  }

  /** Id (1, 2, 3...) da pessoa do trecho; `null` só se não houver como decidir (trecho curto antes de qualquer grupo). */
  assign(embedding: ArrayLike<number>, durationMs: number): number | null {
    const reliable = durationMs >= this.minReliableMs;
    let best: { id: number; sim: number } | null = null;
    for (const c of this.clusters) {
      const sim = cosine(c.sum, embedding);
      if (!best || sim > best.sim) best = { id: c.id, sim };
    }
    if (best && best.sim >= this.threshold) {
      if (reliable) this.add(best.id, embedding);
      return (this.last = best.id);
    }
    if (!reliable) return best ? (this.last = this.last ?? best.id) : null; // trecho curto e estranho: fica com quem falava antes
    if (this.clusters.length >= this.maxSpeakers && best) {
      this.add(best.id, embedding);
      return (this.last = best.id);
    }
    const id = this.clusters.length + 1;
    this.clusters.push({ id, n: 1, sum: Array.from(embedding) });
    return (this.last = id);
  }

  private add(id: number, embedding: ArrayLike<number>): void {
    const c = this.clusters.find((x) => x.id === id)!;
    // soma de embeddings normalizados: o centroide pesa cada trecho igualmente, sem deixar um longo dominar
    const norm = Math.sqrt(Array.from(embedding).reduce((a, v) => a + v * v, 0)) || 1;
    for (let i = 0; i < c.sum.length; i++) c.sum[i]! += embedding[i]! / norm;
    c.n++;
  }

  snapshot(): ClusterState {
    return { clusters: this.clusters.map((c) => ({ ...c, sum: [...c.sum] })), last: this.last };
  }
}
