import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SHOT_FILE_RE, SHOTS_DIR, SHOTS_INDEX, type Shot } from '../../shared/screenshots';
import { writeAtomic } from '../store/meeting-files';

/** Teto por reunião: uma call de 4 h a cada 15 s não enche o disco nem o prompt. */
export const MAX_SHOTS = 240;

export const shotsDir = (meetingDir: string) => join(meetingDir, SHOTS_DIR);
const indexPath = (meetingDir: string) => join(meetingDir, SHOTS_INDEX);

const chains = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

const isTrigger = (x: unknown): x is { segmentAt: string; text: string } => typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>).segmentAt === 'string' && typeof (x as Record<string, unknown>).text === 'string';

/** Lê `capturas.json` com tolerância: itens malformados ou com nome fora da regra são ignorados, nunca lançam. */
export async function listShots(meetingDir: string): Promise<Shot[]> {
  try {
    const raw = JSON.parse(await readFile(indexPath(meetingDir), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x): Shot[] => {
      const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      if (typeof o.file !== 'string' || !SHOT_FILE_RE.test(o.file)) return [];
      return [{
        file: o.file,
        at: typeof o.at === 'string' ? o.at : '',
        offsetMs: Number.isFinite(o.offsetMs) ? Number(o.offsetMs) : 0,
        caption: typeof o.caption === 'string' ? o.caption.slice(0, 300) : '',
        segment: typeof o.segment === 'string' ? o.segment : null,
        ...(isTrigger(o.trigger) ? { trigger: { segmentAt: o.trigger.segmentAt, text: o.trigger.text.slice(0, 300) } } : {}),
        ...(o.manual === true ? { manual: true as const } : {}),
      }];
    });
  } catch {
    return [];
  }
}

const saveIndex = (meetingDir: string, shots: Shot[]) => writeAtomic(indexPath(meetingDir), JSON.stringify(shots, null, 2));

/** Nome livre para o relógio dado (HHMMSS, ou HHMMSS-2 se já existir). */
export function freeName(clock6: string, taken: ReadonlySet<string>): string {
  if (!taken.has(`${clock6}.jpg`)) return `${clock6}.jpg`;
  for (let n = 2; n < 100; n++) if (!taken.has(`${clock6}-${n}.jpg`)) return `${clock6}-${n}.jpg`;
  return `${clock6}-99.jpg`;
}

export type NewShot = Omit<Shot, 'file'> & { clock6: string; jpeg: Buffer };

/** Grava o JPEG em `capturas/` e o registra no index. Devolve null se o teto da reunião foi atingido. */
export function addShot(meetingDir: string, input: NewShot): Promise<Shot | null> {
  return serial(meetingDir, async () => {
    const shots = await listShots(meetingDir);
    if (shots.length >= MAX_SHOTS) return null;
    await mkdir(shotsDir(meetingDir), { recursive: true, mode: 0o700 });
    const file = freeName(input.clock6, new Set(shots.map((s) => s.file)));
    await writeFile(join(shotsDir(meetingDir), file), input.jpeg, { mode: 0o600, flag: 'wx' });
    const shot: Shot = { file, at: input.at, offsetMs: input.offsetMs, caption: input.caption, segment: input.segment, ...(input.trigger ? { trigger: input.trigger } : {}), ...(input.manual ? { manual: true } : {}) };
    await saveIndex(meetingDir, [...shots, shot]);
    return shot;
  });
}

/** Caminho absoluto de uma captura do index (nunca de fora de `capturas/`). */
export async function shotPath(meetingDir: string, file: unknown): Promise<string | null> {
  if (typeof file !== 'string' || !SHOT_FILE_RE.test(file)) return null;
  const known = (await listShots(meetingDir)).some((s) => s.file === file);
  return known ? join(shotsDir(meetingDir), file) : null;
}

/** Remove do index e apaga o arquivo. */
export function removeShot(meetingDir: string, file: unknown): Promise<boolean> {
  return serial(meetingDir, async () => {
    if (typeof file !== 'string' || !SHOT_FILE_RE.test(file)) return false;
    const shots = await listShots(meetingDir);
    if (!shots.some((s) => s.file === file)) return false;
    await rm(join(shotsDir(meetingDir), file), { force: true });
    await saveIndex(meetingDir, shots.filter((s) => s.file !== file));
    return true;
  });
}
