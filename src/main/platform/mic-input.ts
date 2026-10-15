import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Microfone no Windows: lista de entradas do `rice-audio.exe --list-inputs`, a escolha do usuário (passada ao helper pela variável
 * RICE_MIC_DEVICE, que o processo filho herda: o `AudioCapture` compartilhado com o Mac não muda) e o evento aditivo `mic-device`.
 */
export type MicInput = { id: string; name: string; isDefault: boolean; state: string };
export type MicDeviceEvent = { id: string; name: string; isDefault: boolean; chosen: boolean; reason: string };

const execFileAsync = promisify(execFile);

/** Lê a linha JSON do `--list-inputs` (descarta o malformado e o que não tem id). */
export function parseMicInputs(text: string): MicInput[] {
  try {
    const parsed = JSON.parse(text.trim().split(/\r?\n/).filter(Boolean).pop() ?? '[]') as unknown;
    const raw = Array.isArray(parsed) ? parsed : (parsed as { inputs?: unknown } | null)?.inputs; // {"inputs":[…]} (o do helper) ou a lista pura
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x): MicInput[] => {
      const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      if (typeof o.id !== 'string' || o.id === '') return [];
      return [{ id: o.id, name: typeof o.name === 'string' ? o.name : o.id, isDefault: o.isDefault === true, state: typeof o.state === 'string' ? o.state : 'active' }];
    });
  } catch {
    return [];
  }
}

/** O evento `mic-device` do helper (opcional: o do Mac não emite). null se não for um. */
export function parseMicDeviceEvent(event: { event?: unknown; [k: string]: unknown }): MicDeviceEvent | null {
  if (event.event !== 'mic-device' || typeof event.id !== 'string' || typeof event.name !== 'string') return null;
  return { id: event.id, name: event.name, isDefault: event.isDefault === true, chosen: event.chosen === true, reason: typeof event.reason === 'string' ? event.reason : '' };
}

/** Entradas ativas; qualquer falha (sem binário, tempo esgotado) = lista vazia, e a UI só oferece "Padrão do sistema". */
export async function listMicInputs(binary: string): Promise<MicInput[]> {
  try {
    const { stdout } = await execFileAsync(binary, ['--list-inputs'], { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
    return parseMicInputs(stdout);
  } catch {
    return [];
  }
}

/** Define (ou limpa) a escolha para os próximos helpers. Sem escolha, o helper segue o padrão do sistema. */
export function applyMicDevice(env: NodeJS.ProcessEnv, id: string | undefined): void {
  if (id) env.RICE_MIC_DEVICE = id;
  else delete env.RICE_MIC_DEVICE;
}
