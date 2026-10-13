import type { SessionState } from '../session/meeting-session';
import type { CalEvent } from '../calendar/google-events';

/** Valor guardado em `settings.recordShortcut` para "Nenhum". */
export const SHORTCUT_NONE = 'none';

type Platform = NodeJS.Platform;
const MODIFIERS: Record<string, 'Control' | 'Alt' | 'Shift' | 'Command' | 'CommandOrControl'> = {
  control: 'Control', ctrl: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift', command: 'Command', cmd: 'Command', super: 'Command', meta: 'Command', commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl',
};
const KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/;
const ORDER = ['Control', 'Alt', 'Shift', 'Command'] as const;

/** ⌥⌘R no Mac, Ctrl+Alt+R nos demais. */
export const defaultShortcut = (platform: Platform = process.platform): string => (platform === 'darwin' ? 'Alt+Command+R' : 'Control+Alt+R');

/**
 * Aceita só o que o app sabe registrar: pelo menos um de Command/Control/Alt (Shift sozinho dispararia ao digitar) e uma tecla
 * A-Z, 0-9 ou F1-F24. Devolve a forma canônica (ordem fixa, "CommandOrControl" resolvido para a plataforma) ou null.
 */
export function parseShortcut(raw: unknown, platform: Platform = process.platform): string | null {
  if (typeof raw !== 'string' || raw.length > 60) return null;
  const parts = raw.split('+').map((p) => p.trim());
  const key = parts.pop()?.toUpperCase() ?? '';
  if (!KEY.test(key) || parts.length === 0) return null;
  const mods = new Set<string>();
  for (const p of parts) {
    const m = MODIFIERS[p.toLowerCase()];
    if (!m) return null;
    mods.add(m === 'CommandOrControl' ? (platform === 'darwin' ? 'Command' : 'Control') : m);
  }
  if (![...mods].some((m) => m === 'Command' || m === 'Control' || m === 'Alt')) return null;
  return [...ORDER.filter((m) => mods.has(m)), key].join('+');
}

/** O que registrar para o valor guardado: ausente/ilegível = padrão; "none" = nada. */
export function resolveShortcut(setting: unknown, platform: Platform = process.platform): string | null {
  if (setting === SHORTCUT_NONE) return null;
  return parseShortcut(setting, platform) ?? defaultShortcut(platform);
}

export type ShortcutStatus = { accelerator: string | null; state: 'registered' | 'none' | 'conflict'; defaultAccelerator: string };

export type ShortcutDeps = {
  /** `globalShortcut.register`: devolve false quando outro app já usa o atalho. */
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  onTrigger: () => void;
  platform?: Platform;
};

export function createShortcutManager(deps: ShortcutDeps) {
  const platform = deps.platform ?? process.platform;
  let active: string | null = null;
  let wanted: string | null = null;
  let state: ShortcutStatus['state'] = 'none';

  const status = (): ShortcutStatus => ({ accelerator: wanted, state, defaultAccelerator: defaultShortcut(platform) });

  function tryRegister(accelerator: string): boolean {
    try {
      return deps.register(accelerator, deps.onTrigger);
    } catch {
      return false; // atalho que o sistema recusa: o mesmo aviso de conflito
    }
  }

  /** Início do app: registra o valor guardado. Em conflito o atalho fica desligado e o estado diz isso (as Configurações avisam). */
  function init(setting: unknown): ShortcutStatus {
    return setTo(resolveShortcut(setting, platform)).status;
  }

  function setTo(next: string | null): { ok: boolean; status: ShortcutStatus } {
    if (next === active && (next === null || state === 'registered')) return { ok: true, status: status() };
    const previous = active;
    if (previous) deps.unregister(previous);
    active = null;
    if (next === null) {
      wanted = null;
      state = 'none';
      return { ok: true, status: status() };
    }
    if (tryRegister(next)) {
      active = next;
      wanted = next;
      state = 'registered';
      return { ok: true, status: status() };
    }
    // o novo está em uso por outro app: volta ao que valia antes, para o usuário não ficar sem atalho por uma tentativa
    if (previous && tryRegister(previous)) {
      active = previous;
      wanted = previous;
      state = 'registered';
      return { ok: false, status: { ...status(), state: 'conflict' } };
    }
    wanted = next;
    state = 'conflict';
    return { ok: false, status: status() };
  }

  /** Troca pela escolha do usuário ("none", "default" ou um atalho). `saved` é o que deve ir para as configurações quando `ok`. */
  function change(choice: unknown): { ok: boolean; saved: string; status: ShortcutStatus; invalid?: boolean } {
    if (choice === SHORTCUT_NONE) return { ...setTo(null), saved: SHORTCUT_NONE };
    const target = choice === 'default' ? defaultShortcut(platform) : parseShortcut(choice, platform);
    if (!target) return { ok: false, saved: SHORTCUT_NONE, status: status(), invalid: true };
    return { ...setTo(target), saved: target };
  }

  return { init, change, status, dispose: () => setTo(null) };
}

/** Reunião da agenda para a nota: acontecendo agora ou começando em até 10 min (a regra do "Gravar agora" do Início). */
export const SOON_MS = 10 * 60_000;
export function pickRecordableEvent(events: readonly CalEvent[], now: Date): CalEvent | null {
  const t = now.getTime();
  const candidates = events
    .filter((e) => !e.allDay && (Boolean(e.joinUrl) || e.attendees > 0))
    .map((e) => ({ e, start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((c) => !Number.isNaN(c.start) && !Number.isNaN(c.end) && ((c.start <= t && c.end > t) || (c.start > t && c.start - t <= SOON_MS)));
  if (candidates.length === 0) return null;
  const happening = candidates.filter((c) => c.start <= t).sort((a, b) => b.start - a.start); // a que começou por último é a mais provável
  const upcoming = candidates.filter((c) => c.start > t).sort((a, b) => a.start - b.start);
  return (happening[0] ?? upcoming[0])!.e;
}

export type ToggleDeps = {
  state: () => SessionState;
  /** Eventos da agenda de agora. */
  events: () => readonly CalEvent[];
  now?: () => Date;
  /** Rascunho com a nota do evento (o que já existe ou um novo); devolve a pasta. */
  draftFor: (event: CalEvent) => Promise<string>;
  defaultTitle: () => string;
  start: (input: { title: string; dir?: string }) => Promise<unknown>;
  stop: () => Promise<unknown>;
  notify: (kind: 'recording' | 'stopped' | 'error', detail?: string) => void;
};

/** O atalho: gravando para; parado começa (na nota do evento se houver um). Com a sessão fechando notas, não faz nada. */
export async function toggleRecording(deps: ToggleDeps): Promise<'started' | 'stopped' | 'ignored' | 'error'> {
  const state = deps.state();
  try {
    if (state === 'recording') {
      await deps.stop();
      deps.notify('stopped');
      return 'stopped';
    }
    if (state !== 'idle') return 'ignored';
    const event = pickRecordableEvent(deps.events(), deps.now?.() ?? new Date());
    await deps.start(event ? { title: event.title, dir: await deps.draftFor(event) } : { title: deps.defaultTitle() });
    deps.notify('recording');
    return 'started';
  } catch (err) {
    deps.notify('error', (err as Error).message);
    return 'error';
  }
}
