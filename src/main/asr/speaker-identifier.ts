import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { OnlineSpeakerClusterer } from './speaker-cluster';
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
    await this.embedder.close(); // os grupos (vozes) morrem junto com este objeto: nada é gravado
  }
}

/**
 * A "assinatura de voz" (os vetores de embedding e os centroides dos grupos) existe SÓ EM MEMÓRIA durante a sessão e some quando ela
 * termina: nada vai para o disco (nem `falantes.json`, nem o meta, nem o spool). O que fica na reunião é só o texto: "Pessoa 2"
 * e o nome que o usuário deu. Ao continuar uma gravação os grupos recomeçam do zero.
 */
export const createClusteringIdentifier = (embedder: SpeakerEmbedder): SpeakerIdentifier => new ClusteringIdentifier(embedder, new OnlineSpeakerClusterer({}));

/** Arquivo que versões antigas deixavam em cada reunião com os centroides das vozes; hoje é apagado. */
export const LEGACY_VOICE_FILE = 'falantes.json';

/** Apaga o `falantes.json` legado (só ele) das reuniões; devolve quantos removeu. Nunca mexe em mais nada. */
export async function removeLegacyVoiceFiles(dirs: readonly string[]): Promise<number> {
  let removed = 0;
  for (const dir of dirs) {
    try {
      await rm(join(dir, LEGACY_VOICE_FILE));
      removed++;
    } catch {
      // não existe (o normal) ou não deu: segue
    }
  }
  return removed;
}
