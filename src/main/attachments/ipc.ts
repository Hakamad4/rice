import { appendFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { t } from '../i18n';
import { MEETING_FILES, readMeta } from '../store/meeting-files';
import { addFromData, addFromPath, attachmentPath, listAttachments, removeAttachment, type Attachment } from './store';

export type AttachmentsHost = {
  handle: (channel: string, fn: (e: unknown, ...args: any[]) => unknown) => void;
  send: (channel: string, payload: unknown) => void;
  checkedDir: (dir: unknown) => Promise<string>;
  isRecording: (dir: string) => boolean;
  /** Provedor ativo é uma API que aceita imagem? (os CLIs ignoram imagens) */
  imagesSupported: () => Promise<{ provider: string; supported: boolean }>;
  pickFiles: () => Promise<string[]>;
  trash: (path: string) => Promise<void>;
  open: (path: string) => Promise<string>;
  reveal: (path: string) => void;
  thumbnail: (path: string) => string | null;
  /** Indexa de novo a reunião (nomes e texto dos anexos entram na busca). */
  reindex: (dir: string) => void;
};

/** Só tipos que abrem em visualizador; qualquer outro (que poderia ser executável) é mostrado no Finder em vez de aberto. */
const OPENABLE = new Set(['image', 'pdf', 'text']);

export function registerAttachments(host: AttachmentsHost): void {
  const { handle } = host;
  const changed = (dir: string) => {
    host.send('attachments:changed', { dir });
    host.reindex(dir);
  };

  async function addPaths(dir: string, paths: unknown[]) {
    const recording = host.isRecording(dir);
    const startedAt = recording ? new Date((await readMeta(dir)).startedAt).getTime() : 0;
    const results: Array<{ ok: true; item: Attachment } | { ok: false; name: string; message: string }> = [];
    for (const p of paths.slice(0, 50)) {
      try {
        const atMs = recording ? Math.max(0, Date.now() - startedAt) : undefined;
        const item = await addFromPath(dir, String(p), atMs === undefined ? {} : { atMs });
        if (recording) await appendFile(join(dir, MEETING_FILES.transcript), `\n*[Anexo: ${item.name.replace(/[\]\r\n]/g, ' ')}]*\n`).catch(() => undefined);
        results.push({ ok: true, item });
      } catch (err) {
        results.push({ ok: false, name: basename(String(p)), message: (err as Error).message });
      }
    }
    changed(dir);
    return results;
  }

  handle('attachments:list', async (_e, rawDir: unknown) => {
    const dir = await host.checkedDir(rawDir);
    return { items: await listAttachments(dir), images: await host.imagesSupported() };
  });
  handle('attachments:add-paths', async (_e, rawDir: unknown, paths: unknown) => addPaths(await host.checkedDir(rawDir), Array.isArray(paths) ? paths : []));
  handle('attachments:pick', async (_e, rawDir: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const paths = await host.pickFiles();
    return paths.length ? addPaths(dir, paths) : [];
  });
  handle('attachments:add-data', async (_e, rawDir: unknown, name: unknown, bytes: unknown) => {
    const dir = await host.checkedDir(rawDir);
    try {
      const data = Buffer.from(bytes as ArrayBuffer);
      const recording = host.isRecording(dir);
      const atMs = recording ? Math.max(0, Date.now() - new Date((await readMeta(dir)).startedAt).getTime()) : undefined;
      const item = await addFromData(dir, String(name ?? 'imagem.png'), data, atMs === undefined ? {} : { atMs });
      if (recording) await appendFile(join(dir, MEETING_FILES.transcript), `\n*[Anexo: ${item.name.replace(/[\]\r\n]/g, ' ')}]*\n`).catch(() => undefined);
      changed(dir);
      return { ok: true as const, item };
    } catch (err) {
      return { ok: false as const, name: String(name ?? ''), message: (err as Error).message };
    }
  });
  handle('attachments:open', async (_e, rawDir: unknown, file: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const path = await attachmentPath(dir, String(file));
    const item = (await listAttachments(dir)).find((a) => a.file === file);
    if (!item || !OPENABLE.has(item.kind)) {
      host.reveal(path);
      return { ok: true as const };
    }
    const error = await host.open(path);
    return error ? { ok: false as const, message: error } : { ok: true as const };
  });
  handle('attachments:reveal', async (_e, rawDir: unknown, file: unknown) => {
    host.reveal(await attachmentPath(await host.checkedDir(rawDir), String(file)));
    return { ok: true as const };
  });
  handle('attachments:remove', async (_e, rawDir: unknown, file: unknown) => {
    const dir = await host.checkedDir(rawDir);
    try {
      await removeAttachment(dir, String(file), host.trash);
      changed(dir);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: (err as Error).message || t('attach.err.missing') };
    }
  });
  handle('attachments:thumb', async (_e, rawDir: unknown, file: unknown) => {
    const dir = await host.checkedDir(rawDir);
    const item = (await listAttachments(dir)).find((a) => a.file === file);
    return item && item.kind === 'image' ? host.thumbnail(await attachmentPath(dir, item.file)) : null;
  });
}
