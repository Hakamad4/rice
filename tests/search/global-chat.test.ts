import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { AiError, type AiRunner } from '../../src/main/ai/types';
import { askAcrossMeetings, checkScope, type GlobalChatDeps } from '../../src/main/search/global-chat';
import { SearchIndex } from '../../src/main/search/index';
import { createMeeting, writeNotes } from '../../src/main/store/meeting-files';
import { appendGlobalTurn, globalChatFile, readGlobalConversation, startNewGlobalConversation } from '../../src/main/store/global-chat';
import { makeTmpDir } from '../helpers/tmp';

const FOLDERS = [{ id: 'f1', name: 'Acme', createdAt: '', order: 0 }];

function fakeRunner(chunks: string[], final = chunks.join('')): AiRunner & { calls: { system: string; prompt: string }[] } {
  const calls: { system: string; prompt: string }[] = [];
  return {
    calls,
    async *run(options) {
      calls.push({ system: options.system, prompt: options.prompt });
      for (const c of chunks) yield c;
      return final;
    },
  };
}

async function setup(runner: AiRunner) {
  const root = await makeTmpDir();
  const { dir } = await createMeeting(root, { title: 'Kickoff Acme', startedAt: new Date(2026, 9, 1, 10), trigger: 'manual', state: 'draft', folderId: 'f1' });
  await writeNotes(dir, '- Orçamento aprovado em 50 mil');
  const index = new SearchIndex();
  const deps: GlobalChatDeps = {
    root: async () => root,
    folders: async () => FOLDERS,
    index,
    runner,
    language: async () => 'pt',
    noMeetings: (lang) => (lang === 'en' ? 'No meetings found.' : 'Não encontrei reuniões sobre isso.'),
    fallbackNotice: (lang) => (lang === 'en' ? 'No direct mentions; looking at recent meetings…' : 'Não achei menções diretas; olhando as reuniões recentes…'),
    noMeetingsInPeriod: (lang) => (lang === 'en' ? 'No meetings in that period.' : 'Não há reuniões nesse período.'),
    now: () => new Date(2026, 9, 14, 12),
  };
  return { root, dir, deps };
}

describe('askAcrossMeetings', () => {
  test('recupera, manda o contexto numerado à IA, transmite e grava a troca com as citações', async () => {
    const runner = fakeRunner(['O orçamento ', 'foi aprovado [1].']);
    const { root, dir, deps } = await setup(runner);
    const deltas: string[] = [];
    const result = await askAcrossMeetings(deps, 'Qual o orçamento da Acme?', { kind: 'all' }, new AbortController().signal, (d) => deltas.push(d));
    expect(result).toMatchObject({ ok: true, answer: 'O orçamento foi aprovado [1].', citations: [{ n: 1, dir, title: 'Kickoff Acme' }] });
    expect(deltas).toEqual(['O orçamento ', 'foi aprovado [1].']);
    expect(runner.calls[0]!.system).toContain('VÁRIAS reuniões');
    expect(runner.calls[0]!.prompt).toContain('<reuniao n="1">');
    expect(runner.calls[0]!.prompt).toContain('Orçamento aprovado em 50 mil');
    const saved = await readGlobalConversation(root);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ question: 'Qual o orçamento da Acme?', answer: 'O orçamento foi aprovado [1].', scope: { kind: 'all' }, citations: [{ n: 1, dir }] });
  });

  test('termo que nenhuma reunião menciona: a IA recebe as recentes e a resposta abre com o aviso (nunca uma recusa seca)', async () => {
    const runner = fakeRunner(['Foi sobre orçamento [1].']);
    const { root, deps } = await setup(runner);
    const deltas: string[] = [];
    const r = await askAcrossMeetings(deps, 'kubernetes', { kind: 'all' }, new AbortController().signal, (d) => deltas.push(d));
    expect(r).toMatchObject({ ok: true, answer: 'Não achei menções diretas; olhando as reuniões recentes…\n\nFoi sobre orçamento [1].', citations: [{ n: 1, title: 'Kickoff Acme' }] });
    expect(deltas[0]).toBe('Não achei menções diretas; olhando as reuniões recentes…\n\n');
    expect(runner.calls).toHaveLength(1);
    expect((await readGlobalConversation(root))[0]!.answer).toContain('olhando as reuniões recentes');
  });

  test('"última reunião" responde com as recentes, sem aviso de fallback', async () => {
    const runner = fakeRunner(['A última foi o Kickoff Acme [1].']);
    const { deps } = await setup(runner);
    const r = await askAcrossMeetings(deps, 'Última reunião foi sobre o quê?', { kind: 'all' }, new AbortController().signal, () => {});
    expect(r).toMatchObject({ ok: true, answer: 'A última foi o Kickoff Acme [1].' });
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.prompt).toContain('Kickoff Acme');
  });

  test('período sem nenhuma reunião ("ontem"): mensagem do período, sem chamar a IA; sem reuniões nenhuma: a mensagem geral', async () => {
    const runner = fakeRunner(['x']);
    const { deps } = await setup(runner);
    const deltas: string[] = [];
    const r = await askAcrossMeetings(deps, 'o que fizemos ontem?', { kind: 'all' }, new AbortController().signal, (d) => deltas.push(d));
    expect(r).toMatchObject({ ok: true, answer: 'Não há reuniões nesse período.', citations: [] });
    expect(runner.calls).toHaveLength(0);
    const vazio = await setup(fakeRunner(['x']));
    const root = await makeTmpDir();
    const none = await askAcrossMeetings({ ...vazio.deps, root: async () => root }, 'kubernetes', { kind: 'all' }, new AbortController().signal, () => {});
    expect(none).toMatchObject({ ok: true, answer: 'Não encontrei reuniões sobre isso.' });
  });

  test('a conversa anterior vai no prompt; "Nova conversa" zera, mas o arquivo guarda tudo', async () => {
    const runner = fakeRunner(['ok [1]']);
    const { root, deps } = await setup(runner);
    const signal = new AbortController().signal;
    await askAcrossMeetings(deps, 'orçamento', { kind: 'all' }, signal, () => {});
    await askAcrossMeetings(deps, 'e o prazo? orçamento', { kind: 'all' }, signal, () => {});
    expect(runner.calls[1]!.prompt).toContain('<conversa>');
    expect(runner.calls[1]!.prompt).toContain('Usuário: orçamento');
    expect(runner.calls[1]!.prompt).not.toContain('[1]\n\n<pergunta>'); // citações antigas saem do histórico
    await startNewGlobalConversation(root);
    expect(await readGlobalConversation(root)).toEqual([]);
    await askAcrossMeetings(deps, 'orçamento de novo', { kind: 'all' }, signal, () => {});
    expect(runner.calls[2]!.prompt).not.toContain('<conversa>');
    expect((await readFile(globalChatFile(root), 'utf8')).trim().split('\n')).toHaveLength(4); // 2 trocas + marca + 1 troca
  });

  test('erro do provedor volta amigável e não grava', async () => {
    const runner: AiRunner = {
      // eslint-disable-next-line require-yield
      async *run() {
        throw new AiError('auth', 'Sessão expirada.');
      },
    };
    const { root, deps } = await setup(runner);
    expect(await askAcrossMeetings(deps, 'orçamento', { kind: 'all' }, new AbortController().signal, () => {})).toEqual({ ok: false, kind: 'auth', message: 'Sessão expirada.' });
    expect(await readGlobalConversation(root)).toEqual([]);
  });

  test('pergunta vazia ou que não é texto é recusada', async () => {
    const { deps } = await setup(fakeRunner([]));
    for (const bad of ['', '   ', null, 42, {}]) expect(await askAcrossMeetings(deps, bad, { kind: 'all' }, new AbortController().signal, vi.fn())).toMatchObject({ ok: false });
  });

  test('escopo de pasta restringe as reuniões', async () => {
    const runner = fakeRunner(['ok']);
    const { root, deps } = await setup(runner);
    const { dir: other } = await createMeeting(root, { title: 'Fora da pasta', startedAt: new Date(2026, 9, 2), trigger: 'manual', state: 'draft' });
    await writeNotes(other, '- Orçamento da casa');
    const r = await askAcrossMeetings(deps, 'orçamento', { kind: 'folder', folderId: 'f1' }, new AbortController().signal, () => {});
    expect(r).toMatchObject({ ok: true });
    expect((r as any).citations.map((c: any) => c.title)).toEqual(['Kickoff Acme']);
  });
});

describe('checkScope', () => {
  test('só aceita all ou pasta que existe', () => {
    expect(checkScope({ kind: 'folder', folderId: 'f1' }, FOLDERS)).toEqual({ kind: 'folder', folderId: 'f1' });
    for (const bad of [{ kind: 'folder', folderId: 'nope' }, { kind: 'folder' }, { kind: 'x' }, null, undefined, 'all']) expect(checkScope(bad, FOLDERS)).toEqual({ kind: 'all' });
  });
});

describe('arquivo chat-global.jsonl', () => {
  test('ignora linhas quebradas e lê o formato gravado', async () => {
    const root = await makeTmpDir();
    await appendGlobalTurn(root, { question: 'q', answer: 'a [1]', scope: { kind: 'all' }, citations: [{ n: 1, dir: '/R/x', title: 'T', date: '2026-10-01T10:00:00-03:00' }], terms: ['x'] });
    await writeFile(globalChatFile(root), `${await readFile(globalChatFile(root), 'utf8')}{quebrado\n{"type":"turn","question":1}\n`);
    const turns = await readGlobalConversation(root);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ question: 'q', citations: [{ n: 1, title: 'T' }], terms: ['x'] });
  });
  test('nova conversa sem nada na atual não escreve marca', async () => {
    const root = await makeTmpDir();
    await startNewGlobalConversation(root);
    await expect(readFile(globalChatFile(root), 'utf8')).rejects.toThrow();
  });
});

describe('Buscar na web no chat entre reuniões', () => {
  const run = async (webOn: boolean | 'throws') => {
    let rootDir = '';
    const seen: any[] = [];
    const runner: AiRunner = {
      async *run(o) {
        seen.push(o.tools);
        o.tools?.onSources?.([{ url: 'https://nodejs.org/docs', title: 'Node' }]);
        yield 'Resposta';
        return 'Resposta';
      },
    };
    const { root, deps } = await setup(runner);
    rootDir = root;
    deps.web = async () => {
      if (webOn === 'throws') throw new AiError('other', 'sem busca neste provedor');
      return webOn;
    };
    const result = await askAcrossMeetings(deps, 'Qual o orçamento da Acme?', { kind: 'all' }, new AbortController().signal, () => {});
    return { result, seen, root: rootDir };
  };

  test('desligada: sem ferramentas e sem fontes', async () => {
    const { result, seen } = await run(false);
    expect(seen).toEqual([undefined]);
    expect(result).toMatchObject({ ok: true, sources: [] });
  });

  test('ligada: o runner recebe a busca (sem MCP) e a resposta traz as fontes', async () => {
    const { result, seen } = await run(true);
    expect(seen[0]).toMatchObject({ web: true, mcp: false });
    expect(result).toMatchObject({ sources: [{ url: 'https://nodejs.org/docs' }] });
    expect(result).toMatchObject({ ok: true, sources: [{ url: 'https://nodejs.org/docs', title: 'Node' }] });
  });

  test('provedor sem suporte: a pergunta nem sai, o erro é amigável', async () => {
    const { result, seen } = await run('throws');
    expect(seen).toEqual([]);
    expect(result).toMatchObject({ ok: false, message: 'sem busca neste provedor' });
  });

  test('as fontes ficam salvas no turno da conversa', async () => {
    const { root } = await run(true);
    expect((await readGlobalConversation(root))[0]).toMatchObject({ sources: [{ url: 'https://nodejs.org/docs', title: 'Node' }] });
    const off = await run(false);
    expect((await readGlobalConversation(off.root))[0]!.sources).toBeUndefined();
  });
});
