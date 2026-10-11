import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEETING_FILES, writeAtomic } from '../store/meeting-files';
import { OnlineSpeakerClusterer, type ClusterState } from './speaker-cluster';
import type { SpeakerEmbedder } from './speaker-embedder';

/** Identifica "quem é" cada trecho do canal do sistema. Qualquer falha vira `null` (o trecho fica só como "Outros"). */
export interface SpeakerIdentifier {
  identify(pcm: Buffer): Promise<number | null>;
  close(): Promise<void>;
}

const SAMPLE_RATE = 16_000;
const MIN_EMBED_MS = 400;
const MAX_FAILURES = 3;

export class ClusteringIdentifier implements SpeakerIdentifier {
  private failures = 0;

  constructor(
    private readonly embedder: SpeakerEmbedder,
    private readonly clusterer: OnlineSpeakerClusterer,
    private readonly persist: (state: ClusterState) => Promise<void> = async () => {},
  ) {}

  async identify(pcm: Buffer): Promise<number | null> {
    if (this.failures >= MAX_FAILURES) return null;
    const durationMs = (pcm.length / 2 / SAMPLE_RATE) * 1000;
    if (durationMs < MIN_EMBED_MS) return this.clusterer.lastSpeaker; // curto demais para uma voz: quem falava antes
    try {
      const embedding = await this.embedder.embed(pcm);
      this.failures = 0;
      return this.clusterer.assign(embedding, durationMs);
    } catch {
      this.failures++;
      return null;
    }
  }

  async close(): Promise<void> {
    await this.persist(this.clusterer.snapshot()).catch(() => {});
    await this.embedder.close();
  }
}

/** Estado dos grupos de uma reunião (para "continuar gravação" manter "Pessoa 2" como a mesma pessoa). */
export async function loadClusterState(dir: string): Promise<ClusterState | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(dir, MEETING_FILES.speakers), 'utf8')) as ClusterState;
    return Array.isArray(raw.clusters) ? raw : undefined;
  } catch {
    return undefined;
  }
}

export const saveClusterState = (dir: string, state: ClusterState): Promise<void> => writeAtomic(join(dir, MEETING_FILES.speakers), `${JSON.stringify(state)}\n`);
