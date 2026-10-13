import { readFile } from 'node:fs/promises';

/** O que `scripts/write-build-info.mjs` grava em `out/build-info.json`. O caminho do clone é local e nunca sai do app. */
export type BuildInfo = {
  commit: string;
  commitDate: string | null;
  date: string | null;
  /** Só "github.com/WalissonCF/rice"; qualquer outro valor vira null. */
  remote: 'github.com/WalissonCF/rice' | null;
  clonePath: string | null;
};

export const PUBLIC_REPO = 'github.com/WalissonCF/rice';

const str = (v: unknown, max = 4096): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max && !/[\0\r\n]/.test(v) ? v : null);

/** Valida o JSON do arquivo (nada do que vem dele é confiado às cegas); sem commit válido, não há o que comparar. */
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const commit = str(o.commit, 40);
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) return null;
  const valid = (v: unknown) => {
    const d = str(v, 40);
    return d && !Number.isNaN(Date.parse(d)) ? d : null;
  };
  return { commit, commitDate: valid(o.commitDate), date: valid(o.date), remote: o.remote === PUBLIC_REPO ? PUBLIC_REPO : null, clonePath: str(o.clonePath) };
}

export async function readBuildInfo(file: string): Promise<BuildInfo | null> {
  try {
    return parseBuildInfo(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null; // app sem o arquivo (dev antigo): sem verificação de versão
  }
}
