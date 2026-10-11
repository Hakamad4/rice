import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createMeeting, readMeta, updateMeta } from '../../src/main/store/meeting-files';
import { discardEmptyDraft, findEmptyDraft, isEmptyDraft, reuseDraft } from '../../src/main/store/drafts';
import { readConfig, writeConfig, defaultConfig } from '../../src/main/warroom/store';
import { makeTmpDir } from '../helpers/tmp';

const OLD = new Date('2026-10-01T10:00:00');
const draftIn = (root: string, startedAt = OLD, extra: Record<string, unknown> = {}) => createMeeting(root, { title: '', startedAt, trigger: 'manual', state: 'draft', ...extra }).then((r) => r.dir);

describe('rascunho vazio', () => {
  test('reaproveita o rascunho vazio mais recente (nunca gravado, sem nada escrito)', async () => {
    const root = await makeTmpDir();
    const older = await draftIn(root, new Date('2026-09-01T10:00:00'));
    const newer = await draftIn(root, new Date('2026-10-05T10:00:00'));
    expect(await isEmptyDraft(newer)).toBe(true);
    expect(await findEmptyDraft(root)).toBe(newer);
    expect(older).not.toBe(newer);
  });

  test('não reaproveita rascunho com conteúdo, renomeado, vinculado à agenda, gravado ou com anexos', async () => {
    const root = await makeTmpDir();
    const withNotes = await draftIn(root);
    await writeFile(join(withNotes, 'anotacoes.md'), 'minha anotação');
    expect(await isEmptyDraft(withNotes)).toBe(false);

    const withSpeech = await draftIn(root, new Date('2026-10-02T10:00:00'));
    await writeFile(join(withSpeech, 'transcricao.md'), '# Transcrição — Reunião\n\n[00:01] Oi\n');
    expect(await isEmptyDraft(withSpeech)).toBe(false);

    const renamed = await draftIn(root, new Date('2026-10-03T10:00:00'));
    await updateMeta(renamed, (m) => ({ ...m, title: 'Planejamento' }));
    expect(await isEmptyDraft(renamed)).toBe(false);

    const fromCalendar = await draftIn(root, new Date('2026-10-04T10:00:00'), { calendarEventId: 'evt-1' });
    expect(await isEmptyDraft(fromCalendar)).toBe(false);

    const recorded = await draftIn(root, new Date('2026-10-06T10:00:00'));
    await updateMeta(recorded, (m) => ({ ...m, state: 'recording', sessions: [{ startedAt: m.startedAt }] }));
    expect(await isEmptyDraft(recorded)).toBe(false);

    const attached = await draftIn(root, new Date('2026-10-07T10:00:00'));
    await writeFile(join(attached, 'chat.jsonl'), '{}\n');
    expect(await isEmptyDraft(attached)).toBe(false);
    await writeFile(join(attached, 'chat.jsonl'), '');
    expect(await isEmptyDraft(attached)).toBe(false); // qualquer arquivo além do padrão conta como conteúdo

    expect(await findEmptyDraft(root)).toBeNull();
  });

  test('war room vazia (só o tipo) continua reaproveitável; com achado ou fonte ligada não', async () => {
    const root = await makeTmpDir();
    const dir = await draftIn(root);
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom' });
    expect(await findEmptyDraft(root)).toBe(dir);
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom', sources: { web: true, mcp: false, folder: null } });
    expect(await findEmptyDraft(root)).toBeNull();
  });

  test('reuso: nova hora de início, pasta pedida e a reunião vira War room', async () => {
    const root = await makeTmpDir();
    const dir = await draftIn(root);
    const now = new Date('2026-10-11T09:00:00');
    await reuseDraft(dir, { startedAt: now, folderId: 'f-1', kind: 'warroom' });
    const meta = await readMeta(dir);
    expect(meta.startedAt.startsWith('2026-10-11T09:00:00')).toBe(true);
    expect(meta.folderId).toBe('f-1');
    expect((await readConfig(dir)).kind).toBe('warroom');
    await reuseDraft(dir, { startedAt: now }); // sem pasta: tira a anterior
    expect((await readMeta(dir)).folderId).toBeUndefined();
  });

  test('limpeza ao sair: vazio vai para a Lixeira; com conteúdo, não', async () => {
    const root = await makeTmpDir();
    const empty = await draftIn(root);
    const full = await draftIn(root, new Date('2026-10-02T10:00:00'));
    await writeFile(join(full, 'notas.md'), 'texto');
    const trash = vi.fn(async () => {});
    expect(await discardEmptyDraft(full, trash)).toBe(false);
    expect(trash).not.toHaveBeenCalled();
    expect(await discardEmptyDraft(empty, trash)).toBe(true);
    expect(trash).toHaveBeenCalledWith(empty);
  });
});
