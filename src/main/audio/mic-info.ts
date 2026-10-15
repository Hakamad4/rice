/**
 * Microfone em uso (Mac e Windows), só para mostrar e registrar. NÃO toca na captura: quem informa é o helper (evento `mic-device`, Windows) ou o
 * detector (entrada padrão, Mac); aqui só se normaliza o que chega, se guarda na reunião (`meta.micName` + `meta.micChanges`) e se decide o aviso de troca.
 *
 * Formato combinado (ver o relatório da branch): { id?, name, isDefault, chosen }
 *  - name: nome do dispositivo; isDefault: é a entrada padrão do sistema; chosen: o usuário o escolheu no Rice (settings.micDevice).
 */
export type MicInfo = { id?: string; name: string; isDefault: boolean; chosen: boolean };
export type MicChange = { at: string; name: string };

const MAX_NAME = 120;
const MAX_CHANGES = 30;

/** Normaliza o que veio do helper/detector; sem nome útil, não há o que mostrar (null). */
export function normalizeMic(raw: unknown): MicInfo | null {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
  if (!name) return null;
  const id = typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 300 ? o.id : undefined;
  return { ...(id ? { id } : {}), name, isDefault: o.isDefault === true, chosen: o.chosen === true };
}

/** Nome curto para o chip: "Microphone (FIFINE K669 Microphone)" (como o Windows lista) vira "FIFINE K669 Microphone"; corta com reticências. */
export function shortMicName(name: string, max = 28): string {
  const wrapped = /^(?:microphone|microfone|headset microphone|line in|entrada de linha)\s*\((.+)\)$/i.exec(name.trim());
  const base = (wrapped ? wrapped[1]! : name).trim();
  const chars = Array.from(base);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : base;
}

type MetaMic = { micName?: string; micChanges?: MicChange[] };

/** Aplica o microfone à meta da reunião: `micName` guarda o último; `micChanges` guarda as trocas (só quando o nome muda). */
export function applyMic<T extends MetaMic>(meta: T, info: MicInfo, at: string): T {
  if (meta.micName === info.name) return meta;
  const changes = [...(meta.micChanges ?? []), { at, name: info.name }].slice(-MAX_CHANGES);
  return { ...meta, micName: info.name, micChanges: changes };
}

/** "Microfone trocado para X" só quando já havia um microfone nesta gravação e o nome mudou. */
export const isMicSwitch = (previous: string | undefined, next: string): boolean => previous !== undefined && previous !== next;

/** Entradas para o seletor: só id, nome limpo e se é a padrão (o resto do que o helper informa não vai para a tela). */
export function cleanInputs(inputs: ReadonlyArray<{ id: string; name: string; isDefault: boolean }>): Array<{ id: string; name: string; isDefault: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string; isDefault: boolean }> = [];
  for (const i of inputs.slice(0, 64)) {
    const name = i.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!i.id || i.id.length > 512 || !name || seen.has(i.id)) continue;
    seen.add(i.id);
    out.push({ id: i.id, name, isDefault: i.isDefault === true });
  }
  return out;
}
