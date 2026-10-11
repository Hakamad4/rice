import { logWarn } from '../log';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listMeetingDirs, readMeetingText, readMeta, updateMeta } from '../store/meeting-files';
import { repairWavHeader } from './audio-recovery';

async function repairOrphanWavs(dir: string): Promise<void> {
  for (const name of await readdir(dir)) if (/^audio(-\d+)?\.wav$/.test(name)) await repairWavHeader(join(dir, name));
}

export type RecoveryResult = { recovered: string[]; skipped: Array<{ dir: string; error: string }>; /** Notas que ficaram "pendentes" por uma queda e agora constam como falhas (com botão Gerar). */ stuckNotes: string[] };

/**
 * Ao abrir: reuniões que estavam gravando/finalizando viram "interrompidas" e o áudio órfão ganha cabeçalho legível
 * (rápido, sem recodificar). `repairAudio` é injetável nos testes; a codificação e a transcrição do que ficou sem texto
 * acontecem em "Recuperar reunião" (`recover-meeting.ts`).
 */
export async function recoverInterrupted(root: string, options: { repairAudio?: (dir: string) => Promise<unknown> } = {}): Promise<RecoveryResult> {
  const repairAudio = options.repairAudio ?? repairOrphanWavs;
  const recovered: string[] = [];
  const skipped: RecoveryResult['skipped'] = [];
  const stuckNotes: string[] = [];
  for (const dir of await listMeetingDirs(root)) {
    try {
      const meta = await readMeta(dir);
      if (meta.state === 'recording' || meta.state === 'finishing') {
        await updateMeta(dir, (m) => ({ ...m, state: 'interrupted' }));
        await repairAudio(dir).catch((err) => logWarn('recovery: audio repair failed', err));
        recovered.push(dir);
      } else if (meta.state === 'done' && meta.notesStatus === 'pending' && (await readMeetingText(dir, 'transcript')).includes('**[')) {
        // R-47: a geração morreu junto com o app (no boot nada está gerando); em vez de "pendente" para sempre, vira "falhou" com o botão Gerar
        await updateMeta(dir, (m) => ({ ...m, notesStatus: 'failed' }));
        stuckNotes.push(dir);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      skipped.push({ dir, error });
      logWarn('recovery: skipping an unreadable meeting');
    }
  }
  return { recovered, skipped, stuckNotes };
}
