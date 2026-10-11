import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { buildCodexArgs, parseCodexLine } from '../../src/main/ai/codex-cli';
import { toolLine } from '../../src/main/ai/chat-run';
import { buildClaudeArgs } from '../../src/main/claude/runner';
import { parseClaudeLine } from '../../src/main/claude/stream';
import { DEFAULT_MAX_CYCLES, normalizeMaxCycles, parseFacts, parseIdeas, WarRoomEngine } from '../../src/main/warroom/engine';
import { checkWorkFolder } from '../../src/main/warroom/folder';
import { addIdeaToAnnotations, defaultConfig, MORE_CYCLES, normalizeConfig, readConfig, readIdeas, writeConfig } from '../../src/main/warroom/store';
import { sourcesNote, supportFor } from '../../src/main/warroom/ipc';
import { makeTmpDir } from '../helpers/tmp';

const after = (args: string[], flag: string) => args.slice(args.indexOf(flag) + 1);

describe('allowlists do Claude por combinação de fontes', () => {
  test('sem fontes: modo seguro, sem ferramentas e sem MCP', () => {
    const a = buildClaudeArgs('s');
    expect(a).toContain('--safe-mode');
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a).not.toContain('--allowedTools');
  });
  test('internet: só WebSearch e WebFetch, MCP desligado', () => {
    const a = buildClaudeArgs('s', undefined, { web: true });
    expect(a[a.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(after(a, '--allowedTools').slice(0, 2)).toEqual(['WebSearch', 'WebFetch']);
    expect(a).toContain('--strict-mcp-config');
    expect(a).not.toContain('--add-dir');
    expect(a.join(' ')).not.toMatch(/Bash|Edit|Write/);
  });
  test('pasta: Read/Grep/Glob limitados à pasta e --add-dir', () => {
    const a = buildClaudeArgs('s', undefined, { folder: '/proj/x' });
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
    expect(after(a, '--allowedTools').slice(0, 3)).toEqual(['Read(//proj/x/**)', 'Grep(//proj/x/**)', 'Glob(//proj/x/**)']);
    expect(after(a, '--add-dir')[0]).toBe('/proj/x');
    expect(a.join(' ')).not.toMatch(/Bash|Edit|Write|WebFetch/);
  });
  test('internet + pasta: sem Bash/Edit/Write; leitura só na pasta (regras por caminho, --add-dir e cwd)', () => {
    const a = buildClaudeArgs('s', undefined, { web: true, folder: '/proj/x' });
    const allowed = after(a, '--allowedTools').slice(0, 5);
    expect(allowed).toEqual(['WebSearch', 'WebFetch', 'Read(//proj/x/**)', 'Grep(//proj/x/**)', 'Glob(//proj/x/**)']);
    expect(a.join(' ')).not.toMatch(/Bash|Edit|Write|NotebookEdit/);
    expect(allowed.filter((x) => /^(Read|Grep|Glob)$/.test(x))).toEqual([]); // nenhuma regra de leitura sem caminho
    expect(after(a, '--add-dir')[0]).toBe('/proj/x');
  });
  test('internet + pasta + MCP', () => {
    const a = buildClaudeArgs('s', undefined, { web: true, folder: '/p', mcpServers: ['notion'] });
    expect(a[a.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch,Read,Grep,Glob');
    expect(after(a, '--allowedTools').slice(0, 3)).toEqual(['mcp__notion', 'WebSearch', 'WebFetch']);
    expect(a).not.toContain('--strict-mcp-config');
  });
});

describe('argumentos do Codex', () => {
  test('internet liga só a busca; sandbox continua somente leitura e a config do usuário não carrega', () => {
    const a = buildCodexArgs('/w', undefined, ['shell_tool'], { web: true });
    expect(a).toContain('--ignore-user-config');
    expect(a).toContain('web_search="live"');
    expect(after(a, '--sandbox')[0]).toBe('read-only');
    expect(after(a, '--disable')).toContain('shell_tool');
  });
  test('nunca habilita shell, em nenhuma combinação de fontes (inclusive pedindo pasta)', () => {
    const all = ['shell_tool', 'unified_exec', 'apps'];
    for (const mcp of [false, true]) for (const web of [false, true]) for (const folder of [undefined, '/proj']) {
      const a = buildCodexArgs('/w', undefined, all, { mcp, web, folder } as any);
      for (const f of ['shell_tool', 'unified_exec']) expect(a.join(' ')).toContain(`--disable ${f}`);
      expect(a).not.toContain('--add-dir');
      expect(after(a, '-C')[0]).toBe('/w');
      expect(after(a, '--sandbox')[0]).toBe('read-only');
    }
  });
  test('Codex: pasta indisponível com o motivo; internet e MCP seguem', () => {
    const s = supportFor('chatgpt-sub');
    expect(s.folder.available).toBe(false);
    expect(s.folder.reason).toContain('Claude');
    expect(s.web.available && s.mcp.available).toBe(true);
  });
  test('eventos de busca e de comando viram chamadas com detalhe', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'item.started', item: { type: 'web_search', query: 'preço do dólar' } }))).toEqual({ tool: { server: 'web', tool: 'search', detail: 'preço do dólar' } });
  });
});

test('Claude: o input da ferramenta nativa vira o detalhe da chamada', () => {
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'x y' } }] } });
  expect(parseClaudeLine(line)).toEqual({ kind: 'tool', server: 'web', tool: 'WebSearch', detail: 'x y' });
  expect(toolLine({ server: 'web', tool: 'WebSearch', detail: 'x y' }, 'pt-BR')).toBe('*Busca: x y*');
  expect(toolLine({ server: 'file', tool: 'Read', detail: '/p/a.ts' }, 'en')).toBe('*Read: /p/a.ts*');
});

test('provedores sem ferramentas (OpenCode, API) ficam indisponíveis com motivo', () => {
  for (const p of ['opencode-sub', 'claude-api'] as const) {
    const s = supportFor(p);
    expect(s.web.available || s.mcp.available || s.folder.available).toBe(false);
    expect(s.web.reason).toBeTruthy();
  }
  expect(supportFor('claude-sub').folder.available).toBe(true);
});

test('nota da investigação: nenhuma fonte disponível diz as que funcionam; só uma indisponível diz qual', () => {
  expect(sourcesNote('claude-sub', supportFor('claude-sub'))).toBeNull();
  expect(sourcesNote('opencode-sub', supportFor('opencode-sub'))).toContain('Sua IA ativa é OpenCode.');
  expect(sourcesNote('opencode-sub', supportFor('opencode-sub'))).toContain('com o ChatGPT (internet e MCPs)');
  const codex = sourcesNote('chatgpt-sub', supportFor('chatgpt-sub'));
  expect(codex).toContain('Com ChatGPT, Pasta de trabalho fica indisponível');
  expect(codex).not.toContain('internet');
});

describe('pasta de trabalho', () => {
  test('recusa ~, / , pastas que contêm a home, credenciais e caminhos relativos', async () => {
    const home = await makeTmpDir();
    await mkdir(join(home, '.ssh'), { recursive: true });
    await mkdir(join(home, 'proj'), { recursive: true });
    expect((await checkWorkFolder('/', home)).ok).toBe(false);
    expect((await checkWorkFolder(home, home)).ok).toBe(false);
    expect((await checkWorkFolder(join(home, '..'), home)).ok).toBe(false);
    expect((await checkWorkFolder(join(home, '.ssh'), home)).ok).toBe(false);
    expect((await checkWorkFolder('proj', home)).ok).toBe(false);
    expect((await checkWorkFolder(join(home, 'nao-existe'), home)).ok).toBe(false);
    const ok = await checkWorkFolder(join(home, 'proj'), home);
    expect(ok.ok).toBe(true);
  });
  test('atalho (link simbólico) para a home é recusado pelo caminho real', async () => {
    const home = await makeTmpDir();
    const link = join(await makeTmpDir(), 'atalho');
    await symlink(home, link);
    expect((await checkWorkFolder(link, home)).ok).toBe(false);
  });
});

describe('store e parsers', () => {
  test('persistência de warroom.json e config tolerante a lixo', async () => {
    const dir = await makeTmpDir();
    expect(await readConfig(dir)).toEqual(defaultConfig());
    const cfg = { ...defaultConfig(), kind: 'warroom' as const, ideas: { on: true, intervalMin: 10 } };
    await writeConfig(dir, cfg);
    expect(await readConfig(dir)).toEqual(cfg);
    expect(normalizeConfig({ kind: 'x', ideas: { intervalMin: 7 }, sources: { folder: 'relativo' }, facts: [{ id: 1 }] })).toEqual(defaultConfig());
  });
  test('parsers aceitam JSON dentro de texto e limitam a quantidade', () => {
    expect(parseIdeas('claro:\n[{"kind":"risk","text":"a"},{"text":"b"},{"text":"c"},{"text":"d"}] fim')).toHaveLength(3);
    expect(parseIdeas('sem json')).toEqual([]);
    expect(parseFacts('[{"text":"fato","source":{"type":"url","ref":"https://x"}},{"text":""}]')).toEqual([{ text: 'fato', source: { type: 'url', ref: 'https://x' } }]);
  });
  test('fixar acrescenta sob a seção "Ideias da reunião" e reaproveita a lista', () => {
    const one = addIdeaToAnnotations('minha nota', 'ideia 1', 'Ideias da reunião');
    expect(one).toBe('minha nota\n\n## Ideias da reunião\n\n- ideia 1\n');
    expect(addIdeaToAnnotations(one, 'ideia 2', 'Ideias da reunião')).toBe('minha nota\n\n## Ideias da reunião\n\n- ideia 1\n- ideia 2\n');
  });
});

describe('ciclos', () => {
  const long = 'x'.repeat(400);
  function make(dir: string, replies: string[], over: Record<string, unknown> = {}) {
    const calls: any[] = [];
    const engine = new WarRoomEngine({
      runner: () => ({
        async *run(options: any) {
          calls.push(options);
          yield '';
          return replies.shift() ?? '[]';
        },
      }),
      transcript: async () => long,
      language: async () => 'pt-BR',
      support: async () => ({ web: true, mcp: true, folder: true }),
      emit: () => {},
      ...over,
    } as any);
    return { engine, calls, dir };
  }

  test('ideias: roda, grava ideias.jsonl e conta o ciclo; sem fala nova não roda; sem ferramentas', async () => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 5 } });
    const { engine, calls } = make(dir, ['[{"kind":"idea","text":"Testar com clientes"}]']);
    expect(await engine.tick(dir)).toBe('ran');
    expect(calls[0].tools).toBeUndefined();
    expect((await readIdeas(dir)).map((i) => i.text)).toEqual(['Testar com clientes']);
    expect((await readConfig(dir)).ideasCycles).toBe(1);
    expect(await engine.tick(dir)).toBe('skipped'); // nada novo desde o último ciclo
  });

  test('desligado (reunião comum sem ideias): nunca roda', async () => {
    const dir = await makeTmpDir();
    const { engine, calls } = make(dir, []);
    expect(await engine.tick(dir)).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  test('war room: fontes ligadas viram o pedido de ferramentas; achados entram direto na lista e o contexto leva os fixados', async () => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom', sources: { web: true, mcp: false, folder: '/proj' }, facts: [{ id: 'c1', at: '', text: 'Já confirmado', source: { type: 'audio', ref: '' }, pinned: true }] });
    const { engine, calls } = make(dir, ['[{"text":"Dólar a 5,00","source":{"type":"url","ref":"https://x"}}]']);
    expect(await engine.tick(dir)).toBe('ran');
    expect(calls[0].tools).toMatchObject({ web: true, mcp: false, folder: '/proj' });
    expect(calls[0].prompt).toContain('Já confirmado');
    const facts = (await readConfig(dir)).facts;
    expect(facts.map((f) => [f.text, f.pinned === true])).toEqual([['Já confirmado', true], ['Dólar a 5,00', false]]);
  });

  test('provedor sem suporte: a investigação roda sem ferramentas', async () => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), kind: 'warroom', sources: { web: true, mcp: true, folder: '/proj' } });
    const { engine, calls } = make(dir, [], { support: async () => ({ web: false, mcp: false, folder: false }) });
    await engine.tick(dir);
    expect(calls[0].tools).toBeUndefined();
  });

  test('um ciclo por vez, teto de ciclos e parar cancela o agendamento', async () => {
    const dir = await makeTmpDir();
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 } });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { engine } = make(dir, [], {
      runner: () => ({
        async *run() {
          await gate;
          yield '';
          return '[]';
        },
      }),
    });
    const first = engine.tick(dir);
    await vi.waitFor(() => expect(engine.state(dir).running).toBe(true));
    expect(await engine.tick(dir)).toBe('busy');
    release();
    await first;
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 }, ideasCycles: DEFAULT_MAX_CYCLES });
    expect(await engine.tick(dir)).toBe('limit');
    // "Continuar mais 30" libera só esta reunião
    await writeConfig(dir, { ...(await readConfig(dir)), extraCycles: 30 });
    expect(await engine.tick(dir)).not.toBe('limit');
    await engine.start(dir);
    expect(engine.isScheduled(dir)).toBe(true);
    engine.stop(dir);
    expect(engine.isScheduled(dir)).toBe(false);
  });
});

describe('limite de ciclos configurável', () => {
  test('valores válidos passam; qualquer outro vira o padrão (120)', () => {
    expect([30, 60, 120, 300, 0].map(normalizeMaxCycles)).toEqual([30, 60, 120, 300, 0]);
    expect(normalizeMaxCycles(undefined)).toBe(120);
    expect(normalizeMaxCycles(7)).toBe(120);
    expect(normalizeMaxCycles('300')).toBe(300);
  });
  test('migração: o contador antigo (cycles) vira investigationCycles; as trilhas e extraCycles começam certos', () => {
    const c = normalizeConfig({ cycles: 9 });
    expect(c.investigationCycles).toBe(9);
    expect(c.ideasCycles).toBe(0);
    expect(c.extraCycles).toBe(0);
    expect(normalizeConfig({ cycles: 9, investigationCycles: 4, ideasCycles: 2 })).toMatchObject({ investigationCycles: 4, ideasCycles: 2 });
    expect(MORE_CYCLES).toBe(30);
  });
  test('o motor lê o limite a cada ciclo: 0 = sem limite; ao atingir o teto da trilha, para com "limit"', async () => {
    const dir = await makeTmpDir();
    let max = 1;
    let text = 'fala '.repeat(200);
    const engine = new WarRoomEngine({
      runner: () => ({ async *run() { yield ''; return '[{"kind":"idea","text":"x"}]'; } }),
      transcript: async () => text,
      language: async () => 'pt-BR',
      support: async () => ({ web: false, mcp: false, folder: false }),
      emit: () => {},
      minNewChars: 1,
      maxCycles: async () => max,
    });
    await writeConfig(dir, { ...defaultConfig(), ideas: { on: true, intervalMin: 2 } });
    expect(await engine.tick(dir)).toBe('ran');
    expect(await engine.tick(dir)).toBe('limit'); // limite 1 atingido
    expect((await readConfig(dir)).ideasCycles).toBe(1);
    max = 0; // sem limite
    text += 'mais fala '.repeat(200); // fala nova para o próximo ciclo
    expect(await engine.tick(dir)).toBe('ran');
    expect((await readConfig(dir)).ideasCycles).toBe(2);
  });
});
