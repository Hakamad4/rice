import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { riceTranslateBinary } from '../app/paths';
import { modelsDir } from '../asr/config';
import { TRANSLATION_MANIFEST } from './manifest-data';
import { OFFLINE_TRANSLATION } from './flags';
import { createStubOfflineTranslator, type OfflineTranslator } from './offline';
import { OpusOfflineTranslator } from './opus-engine';

/** Pasta dos modelos de tradução baixados (`<dados do Rice>/models/translate/<modelo>/`). */
export const translateModelsDir = (): string => join(modelsDir(), 'translate');

/**
 * Ponto único onde o motor offline entra: OPUS-MT em CTranslate2 (sidecar `rice-translate`, modelos baixados por idioma).
 * Sem o binário no app (build sem cmake) ou sem manifesto, cai no substituto: nunca instalado, a UI mostra "indisponível".
 * Nada é carregado aqui: o processo e os modelos só sobem na primeira tradução.
 */
export function createOfflineTranslator(enabled: boolean = OFFLINE_TRANSLATION): OfflineTranslator {
  if (!enabled) return createStubOfflineTranslator(); // chave desligada: o motor nem é criado
  const binary = riceTranslateBinary();
  if (TRANSLATION_MANIFEST.models.length === 0 || !existsSync(binary)) return createStubOfflineTranslator();
  return new OpusOfflineTranslator({ manifest: TRANSLATION_MANIFEST, root: translateModelsDir(), binary });
}
