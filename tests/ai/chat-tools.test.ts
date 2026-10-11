import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runChat, toolLine } from '../../src/main/ai/chat-run';
import { buildCodexArgs, parseCodexLine } from '../../src/main/ai/codex-cli';
import { buildClaudeArgs } from '../../src/main/claude/runner';
import { parseClaudeLine } from '../../src/main/claude/stream';
import type { AiRunOptions } from '../../src/main/ai/types';

function fakeRunner(seen: AiRunOptions[]) {
  return {
    async *run(options: AiRunOptions) {
      seen.push(options);
      yield 'antes ';
      options.tools?.onCall({ server: 'notion', tool: 'create_page' });
      yield 'depois';
      return 'antes depois';
    },
  };
}

describe('runChat', () => {
  test('desligado: o runner não recebe pedido de ferramentas e a resposta é a de sempre', async () => {
    const seen: AiRunOptions[] = [];
    const out = await runChat(fakeRunner(seen), { system: 's', prompt: 'p' }, { useTools: false, language: 'pt-BR', onDelta: () => {} });
    expect(seen[0]!.tools).toBeUndefined();
    expect(out).toBe('antes depois');
  });

  test('ligado: pede ferramentas e registra uma linha discreta por chamada', async () => {
    const seen: AiRunOptions[] = [];
    const deltas: string[] = [];
    const out = await runChat(fakeRunner(seen), { system: 's', prompt: 'p' }, { useTools: true, language: 'pt-BR', onDelta: (d) => deltas.push(d) });
    expect(seen[0]!.tools).toBeDefined();
    expect(out).toContain('Ferramenta usada: notion · create_page');
    expect(deltas.join('')).toBe(out);
  });

  test('a linha sanitiza nomes e vale em inglês', () => {
    expect(toolLine({ server: 'a b*', tool: 'x\ny' }, 'en')).toBe('*Tool used: ab · xy*');
  });
});

describe('allowlist MCP-only', () => {
  test('claude sem ferramentas: sem MCP; com ferramentas: só mcp__<servidor>, nunca tools nativas', () => {
    const off = buildClaudeArgs('sys');
    expect(off).toContain('--safe-mode');
    expect(off).not.toContain('--allowedTools');
    const on = buildClaudeArgs('sys', undefined, ['notion', 'clickup']);
    expect(on).not.toContain('--safe-mode');
    expect(on.slice(on.indexOf('--allowedTools') + 1, on.indexOf('--allowedTools') + 3)).toEqual(['mcp__notion', 'mcp__clickup']);
    expect(on[on.indexOf('--tools') + 1]).toBe('');
    expect(on).toContain('{"disableAllHooks":true}');
  });

  test('codex: com ferramentas mantém o sandbox somente leitura e carrega a config do usuário', () => {
    const off = buildCodexArgs('/w');
    const on = buildCodexArgs('/w', undefined, [], true);
    expect(off).toContain('--ignore-user-config');
    expect(on).not.toContain('--ignore-user-config');
    expect(on).toContain('read-only');
  });
});

describe('tool_use', () => {
  test('claude: content_block_start de mcp__servidor__ferramenta', () => {
    const line = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'mcp__notion__create_page' } } });
    expect(parseClaudeLine(line)).toEqual({ kind: 'tool', server: 'notion', tool: 'create_page' });
  });

  test('codex: item.started mcp_tool_call', () => {
    const line = JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'notion', tool: 'create_page' } });
    expect(parseCodexLine(line)).toEqual({ tool: { server: 'notion', tool: 'create_page' } });
  });
});

describe('escopo', () => {
  test('só runChat (chat da reunião e entre reuniões) pede ferramentas; notas, e-mail e extrações nunca', async () => {
    const { readdir } = await import('node:fs/promises');
    const hits: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (/\.ts$/.test(e.name) && /\btools\s*:\s*\{/.test(await readFile(full, 'utf8'))) hits.push(e.name);
      }
    };
    await walk(resolve(__dirname, '../../src/main'));
    expect(hits).toEqual(['chat-run.ts', 'engine.ts']);
  });
});
