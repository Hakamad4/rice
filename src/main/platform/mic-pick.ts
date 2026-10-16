import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Escolha automática do microfone ao gravar (Mac). A lista vem do rice-detector (CoreAudio, só consulta) e o nível das candidatas, quando preciso,
 * de um processo curto do rice-audio (`--probe-inputs`); nada disso mexe na captura. Regras:
 *  1. uma entrada real (não virtual/agregada) em uso por outro processo = a escolhida ("in-use");
 *  2. nenhuma ou várias: mede ~1,2 s das candidatas e fica com a que tem voz ("voice"); NUNCA mede Bluetooth que não esteja em uso
 *     (abrir o microfone do AirPods derruba a call para HFP);
 *  3. inconclusivo, sem medidas ou estourou o tempo: a entrada padrão do macOS ("default"), como sempre.
 * O conjunto todo respeita um orçamento (≤ 2 s): estourou, segue com o padrão.
 */
export type MacInput = { id: string; name: string; transport: string; isDefault: boolean; inUse: boolean };
export type MicProbe = { id: string; rmsDb?: number; voice?: boolean; error?: string };
export type MicPick = { uid: string | undefined; name: string; transport: string; reason: 'in-use' | 'voice' | 'default' | 'fixed' };

const VIRTUAL_NAME = /blackhole|loopback|zoomaudio|zoom audio|teams audio|soundflower|vb-?cable|aggregate|multi-?output|ndi audio|krisp|existential|screenflow|descript/i;
const execFileAsync = promisify(execFile);

export const isVirtual = (input: MacInput): boolean => input.transport === 'virtual' || input.transport === 'aggregate' || VIRTUAL_NAME.test(input.name);

/** Entradas reais que podem ser medidas sem efeito colateral: Bluetooth só se já estiver em uso. */
export const probeable = (inputs: MacInput[]): MacInput[] => inputs.filter((i) => !isVirtual(i) && (i.transport !== 'bluetooth' || i.inUse));

export function parseInputs(raw: unknown): MacInput[] {
  const list = (raw as { inputs?: unknown } | null)?.inputs;
  if (!Array.isArray(list)) return [];
  return list.flatMap((x): MacInput[] => {
    const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id === '') return [];
    return [{ id: o.id, name: typeof o.name === 'string' ? o.name : o.id, transport: typeof o.transport === 'string' ? o.transport : 'other', isDefault: o.isDefault === true, inUse: o.inUse === true }];
  });
}

export function parseProbes(text: string): MicProbe[] {
  try {
    const parsed = JSON.parse(text.trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}') as { levels?: unknown };
    if (!Array.isArray(parsed.levels)) return [];
    return parsed.levels.flatMap((x): MicProbe[] => {
      const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      return typeof o.id === 'string' ? [{ id: o.id, ...(typeof o.rmsDb === 'number' ? { rmsDb: o.rmsDb } : {}), ...(typeof o.voice === 'boolean' ? { voice: o.voice } : {}), ...(typeof o.error === 'string' ? { error: o.error } : {}) }] : [];
    });
  } catch {
    return [];
  }
}

/** `rice-audio --probe-inputs`: processo curto, fora de qualquer gravação. Falha ou tempo esgotado = sem medidas. */
export async function probeInputs(binary: string, ids: string[], ms = 1200): Promise<MicProbe[]> {
  if (ids.length === 0) return [];
  try {
    const { stdout } = await execFileAsync(binary, ['--probe-inputs', ids.join(','), '--ms', String(ms)], { timeout: ms + 1500, maxBuffer: 1024 * 1024 });
    return parseProbes(stdout);
  } catch {
    return [];
  }
}

export type PickDeps = {
  inputs: MacInput[];
  /** Microfone fixo escolhido em Configurações (UID). */
  fixed?: string;
  /** "Escolher o microfone automaticamente" (padrão: ligado). */
  auto?: boolean;
  probe: (ids: string[]) => Promise<MicProbe[]>;
  budgetMs?: number;
  now?: () => number;
};

const asPick = (input: MacInput | undefined, reason: MicPick['reason'], pin: boolean): MicPick => ({ uid: pin ? input?.id : undefined, name: input?.name ?? '', transport: input?.transport ?? 'other', reason });

export async function pickMic(deps: PickDeps): Promise<MicPick> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 2000;
  const def = deps.inputs.find((i) => i.isDefault);
  const fixed = deps.fixed ? deps.inputs.find((i) => i.id === deps.fixed) : undefined;
  if (fixed) return asPick(fixed, 'fixed', true);
  if (deps.auto === false) return asPick(def, 'default', false);

  const real = deps.inputs.filter((i) => !isVirtual(i));
  const inUse = real.filter((i) => i.inUse);
  if (inUse.length === 1) return asPick(inUse[0], 'in-use', !inUse[0]!.isDefault);

  const candidates = probeable(inUse.length > 1 ? inUse : real);
  if (candidates.length >= 2) {
    const left = budget - (now() - started);
    if (left > 400) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<MicProbe[]>((resolve) => {
        timer = setTimeout(() => resolve([]), left);
        timer.unref?.();
      });
      const levels = await Promise.race([deps.probe(candidates.map((c) => c.id)).catch(() => [] as MicProbe[]), timeout]);
      clearTimeout(timer); // a medição venceu: o relógio do orçamento não fica pendurado
      const best = levels.filter((l) => l.voice === true).sort((a, b) => (b.rmsDb ?? -120) - (a.rmsDb ?? -120))[0];
      const chosen = best ? candidates.find((c) => c.id === best.id) : undefined;
      if (chosen) return asPick(chosen, 'voice', !chosen.isDefault);
    }
  }
  return asPick(def, 'default', false);
}

/** Candidatas para o aviso de "microfone mudo": reais, medíveis e diferentes da atual. */
export const alternatives = (inputs: MacInput[], currentId: string | undefined): MacInput[] => probeable(inputs).filter((i) => i.id !== currentId);
