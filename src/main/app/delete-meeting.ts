import { resolve } from 'node:path';
import { t } from '../i18n';
import type { SessionState } from '../session/meeting-session';
import { isInsideRoot } from './paths';

export type DeleteMeetingInput = {
  dir: string;
  root: string;
  sessionState: SessionState;
  /** Pasta da sessão ativa; pode ser nula no início da gravação, antes de publicada. */
  currentDir: string | null;
  /** `shell.trashItem` — recuperável pela Lixeira do macOS. */
  trash: (dir: string) => Promise<void>;
};

/** Não apaga a reunião da sessão ativa — nem qualquer uma enquanto a sessão não está idle e ainda não publicou a pasta. */
export function canDeleteMeeting({ sessionState, currentDir, dir }: { sessionState: SessionState; currentDir: string | null; dir: string }): boolean {
  if (sessionState === 'idle') return true;
  if (!currentDir) return false;
  return resolve(currentDir) !== resolve(dir);
}

/** Move uma reunião para a Lixeira; recusa a que está gravando, a própria raiz e qualquer coisa fora dela. */
export async function deleteMeetingDir({ dir, root, sessionState, currentDir, trash }: DeleteMeetingInput): Promise<void> {
  const resolved = resolve(String(dir ?? ''));
  if (!dir || resolved === resolve(root) || !isInsideRoot(root, resolved)) throw new Error(t('err.outside-root'));
  if (!canDeleteMeeting({ sessionState, currentDir, dir: resolved })) throw new Error(t('err.stop-before-delete'));
  await trash(resolved);
}
