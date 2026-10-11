import { t } from '../i18n';
import { resolve } from 'node:path';
import { isInsideRoot } from './paths';

export type StartRequest = { title: string; trigger: 'manual'; dir?: string };

/** Monta a entrada de `session:start` vinda do renderer: título com fallback e `dir` validado contra a raiz. */
export function parseStartInput(input: { title?: unknown; dir?: unknown } | null | undefined, root: string): StartRequest {
  const title = String(input?.title ?? '').trim() || t('meeting.default-title');
  if (!input?.dir) return { title, trigger: 'manual' };
  const dir = resolve(String(input.dir));
  if (!isInsideRoot(root, dir)) throw new Error(t('err.outside-root'));
  return { title, trigger: 'manual', dir };
}
