import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { ClaudeError, ClaudeRunner } from '../../src/main/claude/runner';
import { generateNotes, regenerateNotes } from '../../src/main/session/notes';
import { BUILTIN_TEMPLATES } from '../../src/main/templates/builtin';
import type { NoteTemplate } from '../../src/shared/types';
import { listVersions } from '../../src/main/store/notes-versions';
import { appendSegment, createMeeting, readMeetingText, readMeta, updateMeta, writeAnnotations } from '../../src/main/store/meeting-files';
import { makeTmpDir } from '../helpers/tmp';

const FAKE = resolve(__dirname, '../fixtures/fake-claude.mjs');
const startedAt = new Date(2026, 9, 8, 14, 0);

async function meeting() {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Daily', startedAt, trigger: 'manual' });
  await appendSegment(dir, startedAt, { id: '1', source: 'Outros', startMs: 0, endMs: 1000, text: 'prazo é sexta' });
  await writeAnnotations(dir, 'confirmar orçamento');
  return dir;
}

const runner = async (mode: string, record?: string) =>
  new ClaudeRunner({
    binary: FAKE,
    cwd: join(await makeTmpDir(), 'cwd'),
    env: { ...process.env, FAKE_CLAUDE_MODE: mode, ...(record ? { FAKE_CLAUDE_RECORD: record } : {}) },
  });

test('gera notas.md e marca done', async () => {
  const dir = await meeting();
  const record = join(await makeTmpDir(), 'rec.json');
  await generateNotes(dir, await runner('ok', record));
  expect(await readMeetingText(dir, 'notes')).toMatch(/^Olá mundo\n/);
  expect((await readMeta(dir)).notesStatus).toBe('done');
  const { stdin } = JSON.parse(await readFile(record, 'utf8'));
  expect(stdin).toContain('prazo é sexta');
  expect(stdin).toContain('confirmar orçamento');
});

test('falha do Claude marca failed e relança', async () => {
  const dir = await meeting();
  const err = await generateNotes(dir, await runner('not-logged-in')).catch((e) => e);
  expect(err).toBeInstanceOf(ClaudeError);
  expect((err as ClaudeError).kind).toBe('not-logged-in');
  expect((await readMeta(dir)).notesStatus).toBe('failed');
  expect(await readMeetingText(dir, 'notes')).toBe('');
});

test('chamadas concorrentes compartilham a mesma execução', async () => {
  const dir = await meeting();
  let calls = 0;
  const fake = {
    async *run() {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      yield { type: 'delta', text: 'x' } as never;
      return 'resultado';
    },
  };
  const [a, b] = await Promise.all([generateNotes(dir, fake as never), generateNotes(dir, fake as never)]);
  expect(a).toBeUndefined();
  expect(b).toBeUndefined();
  expect(calls).toBe(1);
  expect((await readMeta(dir)).notesStatus).toBe('done');
  expect(await readMeetingText(dir, 'notes')).toMatch(/^resultado\n/);
});

const geral = BUILTIN_TEMPLATES[0]!;
const retro: NoteTemplate = {
  id: 'retro', title: 'Retro', description: 'Retrospectiva', icon: 'file-text', builtin: false,
  sections: [{ heading: 'O que foi bem', description: 'Acertos' }],
};
const resolver = (id?: string) => Promise.resolve(id === 'retro' ? retro : geral);

test('usa o template do meta no prompt e no system prompt', async () => {
  const dir = await meeting();
  await updateMeta(dir, (m) => ({ ...m, templateId: 'retro' }));
  const record = join(await makeTmpDir(), 'rec.json');
  await generateNotes(dir, await runner('ok', record), resolver);
  const { stdin, args } = JSON.parse(await readFile(record, 'utf8'));
  expect(stdin).toContain('## O que foi bem');
  expect(stdin).not.toContain('## Resumo');
  expect(args.join(' ')).toContain('#O que foi bem: Acertos');
});

test('regenerar com outro template guarda as notas de antes como versão e grava o templateId', async () => {
  const dir = await meeting();
  await generateNotes(dir, await runner('ok'), resolver);
  await regenerateNotes(dir, { async *run() { return 'novo resumo'; } } as never, 'retro', resolver);
  expect(await readMeetingText(dir, 'notes')).toMatch(/^novo resumo\n/);
  const versions = await listVersions(dir);
  expect(versions).toHaveLength(1);
  expect(await readFile(join(dir, 'notas-versoes', versions[0]!.file), 'utf8')).toMatch(/^Olá mundo\n/);
  await expect(readFile(join(dir, 'notas-anterior.md'), 'utf8')).rejects.toThrow();
  const meta = await readMeta(dir);
  expect(meta.templateId).toBe('retro');
  expect(meta.notesStatus).toBe('done');
});

test('regerar sem notas anteriores não cria versão', async () => {
  const dir = await meeting();
  await regenerateNotes(dir, await runner('ok'), 'retro', resolver);
  expect(await listVersions(dir)).toEqual([]);
});

test('falha ao regerar mantém notas.md, status e template de antes', async () => {
  const dir = await meeting();
  await generateNotes(dir, await runner('ok'), resolver);
  const err = await regenerateNotes(dir, await runner('not-logged-in'), 'retro', resolver).catch((e) => e);
  expect(err).toBeInstanceOf(ClaudeError);
  expect(await readMeetingText(dir, 'notes')).toMatch(/^Olá mundo\n/);
  const meta = await readMeta(dir);
  expect(meta.notesStatus).toBe('done');
  expect(meta.templateId).toBeUndefined();
});

test('regenerar com geração em andamento enfileira uma nova depois dela (transcrição mudou)', async () => {
  const dir = await meeting();
  const transcripts: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let calls = 0;
  const fake = {
    async *run(input: { prompt: string }) {
      transcripts.push(input.prompt);
      if (calls++ === 0) await gate;
      yield { type: 'delta', text: 'x' } as never;
      return `notas ${calls}`;
    },
  };
  const first = generateNotes(dir, fake as never);
  await vi.waitFor(() => expect(calls).toBe(1));
  await appendSegment(dir, startedAt, { id: '2', source: 'Outros', startMs: 5000, endMs: 6000, text: 'segmento novo da retomada' });
  const second = regenerateNotes(dir, fake as never, BUILTIN_TEMPLATES[0]!.id, undefined, { queueAfterCurrent: true });
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toBe(1); // espera a primeira terminar
  release();
  await Promise.all([first, second]);
  expect(calls).toBe(2);
  expect(transcripts[0]).not.toContain('segmento novo da retomada');
  expect(transcripts[1]).toContain('segmento novo da retomada');
  expect(await readMeetingText(dir, 'notes')).toMatch(/^notas 2\n/);
});

describe('idioma das notas', () => {
  const capture = () => {
    const calls: Array<{ system: string; prompt: string }> = [];
    return { calls, runner: { async *run(input: { system: string; prompt: string }) { calls.push(input); return 'ok'; } } as never };
  };
  const builtinResolver = async () => BUILTIN_TEMPLATES[0]!;

  test('reunião em inglês: prompts em inglês e seções do embutido em inglês', async () => {
    const dir = await meeting();
    await updateMeta(dir, (m) => ({ ...m, language: 'en' }));
    const { calls, runner: r } = capture();
    await generateNotes(dir, r, builtinResolver);
    expect(calls[0]!.system).toContain('Always write in English');
    expect(calls[0]!.system).toContain('#Summary:');
    expect(calls[0]!.prompt).toContain('## Decisions');
    expect(calls[0]!.prompt).not.toContain('## Resumo');
  });

  test('pt (padrão) mantém tudo em português; auto pede o idioma predominante e usa os títulos do idioma do app', async () => {
    const dir = await meeting();
    const pt = capture();
    await generateNotes(dir, pt.runner, builtinResolver);
    expect(pt.calls[0]!.prompt).toContain('## Resumo');
    await updateMeta(dir, (m) => ({ ...m, language: 'auto' }));
    const auto = capture();
    await regenerateNotes(dir, auto.runner, BUILTIN_TEMPLATES[0]!.id, builtinResolver, { languageOf: () => ({ language: 'auto', headings: 'en' }) });
    expect(auto.calls[0]!.system).toContain('idioma predominante da transcrição');
    expect(auto.calls[0]!.prompt).toContain('## Summary');
  });

  test('template do usuário e override de embutido não são traduzidos', async () => {
    const dir = await meeting();
    await updateMeta(dir, (m) => ({ ...m, language: 'en' }));
    const mine = { ...BUILTIN_TEMPLATES[0]!, builtin: true, customized: true, sections: [{ heading: 'Meu resumo', description: 'x' }] };
    const { calls, runner: r } = capture();
    await generateNotes(dir, r, async () => mine);
    expect(calls[0]!.prompt).toContain('## Meu resumo');
  });
});

// ---- R-46: uma nova tentativa automática para falha transitória ----
import { AiError } from '../../src/main/ai/types';
import { configureLongNotes } from '../../src/main/session/long-notes';
import { fakeRunner } from '../helpers/fake-runner';

async function plainMeeting() {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Daily', startedAt, trigger: 'manual' });
  await appendSegment(dir, startedAt, { id: '1', source: 'Outros', startMs: 0, endMs: 1000, text: 'prazo é sexta' });
  return dir;
}
const flaky = (kinds: Array<AiError['kind'] | 'ok' | 'empty'>) => {
  let i = 0;
  const base = fakeRunner(() => 'x');
  return Object.assign(
    {
      calls: base.calls,
      async *run(options: Parameters<typeof base.run>[0]) {
        base.calls.push({ system: options.system, prompt: options.prompt });
        const kind = kinds[Math.min(i++, kinds.length - 1)]!;
        if (kind === 'ok') return '## Resumo\n\nok';
        if (kind === 'empty') return '   ';
        throw new AiError(kind, `falha ${kind}`);
      },
    },
    {},
  );
};

test('falha de rede: tenta de novo uma vez e conclui', async () => {
  configureLongNotes({ retryDelayMs: 0 });
  const dir = await plainMeeting();
  const runner = flaky(['network', 'ok']);
  await generateNotes(dir, runner as never);
  expect(runner.calls).toHaveLength(2);
  expect((await readMeta(dir)).notesStatus).toBe('done');
  expect(await readMeetingText(dir, 'notes')).toContain('ok');
});

test('duas falhas seguidas: marca "falhou" depois de uma única repetição (teto finito)', async () => {
  configureLongNotes({ retryDelayMs: 0 });
  const dir = await plainMeeting();
  const runner = flaky(['network', 'other']);
  await expect(generateNotes(dir, runner as never)).rejects.toThrow('falha other');
  expect(runner.calls).toHaveLength(2);
  expect((await readMeta(dir)).notesStatus).toBe('failed');
});

test('autenticação, limite de uso e cancelamento nunca repetem', async () => {
  configureLongNotes({ retryDelayMs: 0 });
  for (const kind of ['auth', 'rate-limit', 'cancelled'] as const) {
    const dir = await plainMeeting();
    const runner = flaky([kind, 'ok']);
    await expect(generateNotes(dir, runner as never)).rejects.toThrow(`falha ${kind}`);
    expect(runner.calls).toHaveLength(1);
  }
});

test('resposta vazia (cortada) conta como falha transitória: repete uma vez e nunca grava notas vazias', async () => {
  configureLongNotes({ retryDelayMs: 0 });
  const dir = await plainMeeting();
  const runner = flaky(['empty', 'empty']);
  await expect(generateNotes(dir, runner as never)).rejects.toBeInstanceOf(AiError);
  expect(runner.calls).toHaveLength(2);
  expect(await readMeetingText(dir, 'notes')).toBe('');
  const ok = flaky(['empty', 'ok']);
  await generateNotes(await plainMeeting(), ok as never);
  expect(ok.calls).toHaveLength(2);
});
