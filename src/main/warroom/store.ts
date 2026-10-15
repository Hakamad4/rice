import { isAbsolutePath } from '../platform';
import { renameRetry } from '../platform/fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getLightFactor } from '../platform/light'; // modo leve: os intervalos padrão ficam maiores

export const INTERVALS = [2, 5, 10, 15] as const;
export type IdeaKind = 'idea' | 'question' | 'risk';
export type Idea = { id: string; at: string; kind: IdeaKind; text: string; pinned?: boolean; dismissed?: boolean; /** Categoria do template que a gerou (ex.: "Objeção") e o template (id + nome na hora). */ category?: string; templateId?: string; templateTitle?: string };
export type FactSource = { type: 'url' | 'file' | 'tool' | 'audio'; ref: string };
/** Achado: entra direto na lista (sem validação). `pinned` = fixado (topo e sempre no contexto); `dismissed` = descartado (some). */
export type Fact = { id: string; at: string; text: string; source: FactSource; pinned?: boolean; dismissed?: boolean };
export type WarRoomConfig = {
  kind: 'meeting' | 'warroom';
  ideas: { on: boolean; intervalMin: number; /** Template de ideias da reunião (padrão: o último escolhido, depois o Geral). */ templateId?: string };
  /** De quanto em quanto tempo a investigação lê a transcrição (independente das ideias). */
  investigation: { intervalMin: number; paused: boolean };
  sources: { web: boolean; mcp: boolean; folder: string | null };
  /** Ciclos feitos por trilha (contam separado) e o que o usuário liberou só para esta reunião ("Continuar mais 30"). */
  ideasCycles: number;
  investigationCycles: number;
  extraCycles: number;
  facts: Fact[];
};
/** Quanto "Continuar mais" libera de uma vez. */
export const MORE_CYCLES = 30;

export const defaultConfig = (): WarRoomConfig => ({ kind: 'meeting', ideas: { on: false, intervalMin: 5 * getLightFactor() }, investigation: { intervalMin: 5 * getLightFactor(), paused: false }, sources: { web: false, mcp: false, folder: null }, ideasCycles: 0, investigationCycles: 0, extraCycles: 0, facts: [] });

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Lê `warroom.json` com tolerância: qualquer lixo vira o padrão. */
export function normalizeConfig(raw: unknown): WarRoomConfig {
  const r = obj(raw);
  const ideas = obj(r.ideas);
  const sources = obj(r.sources);
  const interval = Number(ideas.intervalMin);
  const valid = (n: number) => (INTERVALS as readonly number[]).includes(n);
  const invRaw = Number(obj(r.investigation).intervalMin);
  const ideasMin = valid(interval) ? interval : 5;
  const facts = (Array.isArray(r.facts) ? r.facts : []).flatMap((f): Fact[] => {
    const o = obj(f);
    const src = obj(o.source);
    const type = src.type === 'url' || src.type === 'file' || src.type === 'tool' ? src.type : 'audio';
    // migração do modelo antigo: confirmado → fixado; descartado → descartado; pendente → achado normal
    const pinned = o.pinned === true || o.status === 'confirmed';
    const dismissed = o.dismissed === true || o.status === 'dismissed';
    const text = str(o.text, 600).trim();
    return text && typeof o.id === 'string' ? [{ id: o.id.slice(0, 40), at: str(o.at, 40), text, source: { type, ref: str(src.ref, 400) }, ...(pinned ? { pinned: true } : {}), ...(dismissed ? { dismissed: true } : {}) }] : [];
  });
  return {
    kind: r.kind === 'warroom' ? 'warroom' : 'meeting',
    ideas: { on: ideas.on === true, intervalMin: ideasMin, ...(typeof ideas.templateId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(ideas.templateId) ? { templateId: ideas.templateId } : {}) },
    investigation: { intervalMin: valid(invRaw) ? invRaw : ideasMin, paused: obj(r.investigation).paused === true }, // migração: sem o campo, herda o intervalo das ideias
    sources: { web: sources.web === true, mcp: sources.mcp === true, folder: typeof sources.folder === 'string' && isAbsolutePath(sources.folder) ? sources.folder : null },
    ideasCycles: count(r.ideasCycles),
    // migração: o contador único antigo (`cycles`) era da investigação
    investigationCycles: r.investigationCycles === undefined ? count(r.cycles) : count(r.investigationCycles),
    extraCycles: count(r.extraCycles),
    facts: facts.slice(-200),
  };
}

const configPath = (dir: string) => join(dir, 'warroom.json');
const ideasPath = (dir: string) => join(dir, 'ideias.jsonl');

async function atomicWrite(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await renameRetry(tmp, path);
}

export async function readConfig(dir: string): Promise<WarRoomConfig> {
  try {
    return normalizeConfig(JSON.parse(await readFile(configPath(dir), 'utf8')));
  } catch {
    return defaultConfig();
  }
}
export const writeConfig = (dir: string, cfg: WarRoomConfig) => atomicWrite(configPath(dir), JSON.stringify(cfg, null, 2));

export async function readIdeas(dir: string): Promise<Idea[]> {
  let raw = '';
  try {
    raw = await readFile(ideasPath(dir), 'utf8');
  } catch {
    return [];
  }
  return raw.split('\n').flatMap((line): Idea[] => {
    try {
      const o = obj(JSON.parse(line));
      const kind: IdeaKind = o.kind === 'question' || o.kind === 'risk' ? o.kind : 'idea';
      const text = str(o.text, 600).trim();
      return text && typeof o.id === 'string' ? [{ id: o.id.slice(0, 40), at: str(o.at, 40), kind, text, ...(o.pinned === true ? { pinned: true } : {}), ...(o.dismissed === true ? { dismissed: true } : {}), ...(str(o.category, 40).trim() ? { category: str(o.category, 40).trim() } : {}), ...(str(o.templateId, 64) ? { templateId: str(o.templateId, 64) } : {}), ...(str(o.templateTitle, 80) ? { templateTitle: str(o.templateTitle, 80) } : {}) }] : [];
    } catch {
      return [];
    }
  });
}
export const writeIdeas = (dir: string, ideas: Idea[]) => atomicWrite(ideasPath(dir), ideas.map((i) => JSON.stringify(i)).join('\n') + (ideas.length ? '\n' : ''));

/** Fatos confirmados: o contexto persistente que vai nos próximos ciclos e no chat. */
/** Limite do contexto dos ciclos e do chat: os N achados mais recentes (além dos fixados) e um teto de caracteres. */
export const CONTEXT_FACTS = 12;
export const CONTEXT_CHARS = 3000;

/**
 * Contexto dos próximos ciclos: achados FIXADOS + os mais recentes não descartados, nessa ordem, até o limite de tamanho.
 * (Antes só os confirmados; agora o usuário fixa o que importa e o resto recente também entra.)
 */
export function contextFacts(cfg: WarRoomConfig, maxRecent = CONTEXT_FACTS, maxChars = CONTEXT_CHARS): Fact[] {
  const live = cfg.facts.filter((f) => !f.dismissed);
  const pinned = live.filter((f) => f.pinned);
  const recent = live.filter((f) => !f.pinned).slice(-maxRecent).reverse();
  const out: Fact[] = [];
  let size = 0;
  for (const f of [...pinned, ...recent]) {
    size += f.text.length + 40;
    if (size > maxChars && out.length > 0) break;
    out.push(f);
  }
  return out;
}

/** Põe a ideia fixada sob "## <heading>" nas anotações (cria a seção no fim; ideias seguintes entram na mesma lista). */
export function addIdeaToAnnotations(annotations: string, ideaText: string, heading: string): string {
  const bullet = `- ${ideaText.replace(/\s*\n+\s*/g, ' ').trim()}`;
  const lines = annotations.replace(/\s+$/, '').split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at < 0) return `${annotations.replace(/\s+$/, '')}${annotations.trim() ? '\n\n' : ''}## ${heading}\n\n${bullet}\n`;
  let end = at + 1;
  while (end < lines.length && (lines[end]!.trim() === '' || lines[end]!.startsWith('- '))) end++;
  while (end > at + 1 && lines[end - 1]!.trim() === '') end--;
  lines.splice(end, 0, bullet);
  return `${lines.join('\n')}\n`;
}
