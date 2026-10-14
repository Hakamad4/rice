import type { Folder, FolderRetention } from '../../shared/types';

/** Cadeia da pasta até a raiz (a própria primeiro); protege contra ciclo em arquivo editado à mão. */
function chain(folders: readonly Folder[], id: string | undefined): Folder[] {
  const out: Folder[] = [];
  const seen = new Set<string>();
  for (let cur = folders.find((f) => f.id === id); cur && !seen.has(cur.id); cur = cur.parentId ? folders.find((f) => f.id === cur!.parentId) : undefined) {
    seen.add(cur.id);
    out.push(cur);
  }
  return out;
}

/** A pasta é sensível se ela ou qualquer pasta-mãe for. */
export const isSensitiveFolder = (folders: readonly Folder[], id: string | undefined): boolean => chain(folders, id).some((f) => f.sensitive === true);

/**
 * Regra de guarda efetiva: cada regra (áudio, reunião) é independente e vem da pasta mais próxima que a define (a própria, depois
 * a mãe…), senão do padrão global. `0` = manter sempre. Devolve só o que vale; 0/ausente = nunca apagar.
 */
export function effectiveRetention(folders: readonly Folder[], id: string | undefined, fallback: FolderRetention | undefined): { audioDays: number; meetingMonths: number } {
  const path = chain(folders, id);
  const pick = <K extends keyof FolderRetention>(key: K): number => path.find((f) => f.retention?.[key] !== undefined)?.retention?.[key] ?? fallback?.[key] ?? 0;
  return { audioDays: pick('audioDays'), meetingMonths: pick('meetingMonths') };
}

/** Nome da pasta que define a regra (para o aviso "pela regra da pasta Jurídico"); a própria pasta se for ela, senão a mãe que a definiu. */
export function retentionSource(folders: readonly Folder[], id: string | undefined, key: keyof FolderRetention): Folder | undefined {
  return chain(folders, id).find((f) => f.retention?.[key] !== undefined && f.retention[key] !== 0);
}
