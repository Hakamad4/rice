import type { TranslateLang } from './offline';

/** Um arquivo de um modelo na release: SHA-256 e tamanho fixos no app (o que vale é este hash). */
export type ModelFile = { name: string; sha256: string; bytes: number };
/** Um modelo OPUS-MT convertido para CTranslate2 (int8): `model.bin` + vocabulário + sentencepiece (origem e destino). */
export type ModelEntry = { id: string; files: readonly ModelFile[] };
/** Um passo de tradução: o modelo e, se ele for multilíngue, o token do idioma de destino (ex.: `>>fra<<`). */
export type RouteStep = { model: string; tag?: string };
export type Manifest = {
  version: number;
  /** Release do repositório com os arquivos soltos, `<modelo>.<arquivo>` (ex.: `opus-mt-tc-big-en-pt.model.bin`). */
  baseUrl: string;
  models: readonly ModelEntry[];
  /** `"pt>en"` → passos em ordem. Pares sem inglês podem ser direto (1 passo) ou pivô (2 passos, via `en`). */
  routes: Readonly<Record<string, readonly RouteStep[]>>;
  /** Modelos (ids) que cada idioma exige instalados; o inglês só tem os modelos que os outros pares exigem de `en`. */
  packs: Readonly<Record<TranslateLang, readonly string[]>>;
};

export const routeKey = (from: TranslateLang, to: TranslateLang): string => `${from}>${to}`;

export const modelBytes = (m: ModelEntry): number => m.files.reduce((n, f) => n + f.bytes, 0);
export const assetUrl = (manifest: Manifest, model: string, file: string): string => `${manifest.baseUrl}/${model}.${file}`;
