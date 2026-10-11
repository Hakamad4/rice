import { execFile } from 'node:child_process';
import { chmod, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AGY_MODEL_RE, agyStdin, buildAgyArgs, buildAgyProfile, cleanupAgyConversation, createAgyRunner, lightestAgyModel, listAgyModels, makeAgyParser, parseAgyModels, SANDBOX_EXEC } from '../../src/main/ai/agy-cli';
import { AiError } from '../../src/main/ai/types';
import { makeTmpDir } from '../helpers/tmp';

const FAKE_AGY = resolve(__dirname, '../fixtures/fake-agy.mjs');
const mac = process.platform === 'darwin';
const cleanup: string[] = [];
afterEach(async () => {
  for (const p of cleanup.splice(0)) await rm(p, { recursive: true, force: true });
  delete process.env.FAKE_AGY_MODE;
  delete process.env.FAKE_AGY_RECORD;
  delete process.env.FAKE_AGY_ID;
});

describe('perfil do sandbox', () => {
  const profile = buildAgyProfile({ agy: '/opt/agy/bin/agy', work: '/var/work/run-1', home: '/Users/fulano' });
  test('nega TODA escrita e libera só o temporário vazio e o estado do próprio agy', () => {
    expect(profile).toContain('(deny file-write*)');
    const allow = /\(allow file-write\*([\s\S]*?)\)\n;; processes/.exec(profile)![1]!;
    const paths = [...allow.matchAll(/\((?:subpath|literal) "([^"]+)"\)/g)].map((m) => m[1]);
    expect(paths).toEqual(['/var/work/run-1', '/Users/fulano/.gemini/antigravity', '/Users/fulano/.gemini/antigravity-cli', '/Users/fulano/.gemini/config', '/dev/null', '/dev/tty', '/dev/dtracehelper']);
    expect(profile).not.toMatch(/allow file-write\*[^)]*"\/Users\/fulano"\)/);
    expect(profile).not.toMatch(/allow file-write\*[^)]*"\/tmp/);
  });
  test('nenhum processo, exceto o agy e o security (login); sem shell', () => {
    expect(profile).toContain('(deny process-exec*)');
    expect(profile).toContain('(allow process-exec (literal "/opt/agy/bin/agy") (literal "/usr/bin/security"))');
    expect(profile).not.toMatch(/\/bin\/(ba|z)?sh/);
  });
  test('a pasta pessoal não pode ser lida, salvo o mínimo', () => {
    expect(profile).toContain('(deny file-read* (subpath "/Users/fulano"))');
    const allow = /\(allow file-read\*([\s\S]*)$/.exec(profile)![1]!;
    expect([...allow.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/Users/fulano', '/var/work/run-1', '/opt/agy/bin/agy', '/Users/fulano/.gemini/antigravity', '/Users/fulano/.gemini/antigravity-cli', '/Users/fulano/.gemini/config', '/Users/fulano/.local/bin', '/Users/fulano/Library/Keychains', '/Users/fulano/Library/Preferences', '/Users/fulano/Library/Caches',
    ]);
    expect(allow).not.toMatch(/\.ssh|\.aws|\.codex|\.claude|Documents/);
  });
  test('caminho com aspas ou quebra de linha não vira regra', () => {
    expect(() => buildAgyProfile({ agy: '/x"; (allow default) ;"', work: '/w', home: '/h' })).toThrow();
    expect(() => buildAgyProfile({ agy: '/x', work: '/w\n(allow file-write*)', home: '/h' })).toThrow();
    expect(() => buildAgyProfile({ agy: 'relativo', work: '/w', home: '/h' })).toThrow();
  });
  test('argumentos: prompt só pelo stdin, saída stream-json, nunca as flags de permissão', () => {
    const args = buildAgyArgs('gemini-3.8-flash-low', 120);
    expect(args).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', 'gemini-3.8-flash-low', '--print-timeout', '120s']);
    expect(args.filter((a) => ['--print', '-p', '--prompt', '--dangerously-skip-permissions', '--add-dir', '--mode', '--sandbox'].includes(a))).toEqual([]);
    expect(buildAgyArgs('--evil')).not.toContain('--model');
    expect(AGY_MODEL_RE.test('claude-sonnet-4-6')).toBe(true);
    expect(JSON.parse(agyStdin('olá'))).toEqual({ event: 'user', message: { content: 'olá' } });
  });
});

describe.skipIf(!mac)('o sandbox de verdade (sandbox-exec) nega escrita fora do temporário, leitura da pasta pessoal e execução', () => {
  /** Roda um script `sh` no sandbox com o perfil real; o `dash` (sem re-exec) faz o papel do agy (único processo liberado). */
  async function sandboxed(script: string, work: string, home: string): Promise<{ code: number | null; out: string }> {
    const profile = join(await makeTmpDir(), 'p.sb');
    await writeFile(profile, buildAgyProfile({ agy: '/bin/dash', work, home }));
    return new Promise((resolveRun) => {
      execFile(SANDBOX_EXEC, ['-f', profile, '/bin/dash', '-c', script], { cwd: work, timeout: 20_000 }, (err, stdout, stderr) => resolveRun({ code: err ? ((err as any).code ?? 1) : 0, out: `${stdout}${stderr}` }));
    });
  }

  test('escreve só no temporário; HOME, /tmp e o cwd de fora não recebem nada; comandos não rodam; segredos da pasta pessoal não são lidos', async () => {
    const home = homedir();
    const id = Math.random().toString(36).slice(2);
    const work = await realpath(await makeTmpDir());
    const decoyDir = join(home, `.rice-sandbox-teste-${id}`);
    await mkdir(decoyDir, { recursive: true });
    cleanup.push(decoyDir);
    await writeFile(join(decoyDir, 'segredo.txt'), 'DECOY-SEGREDO');
    await writeFile(join(work, 'ok.txt'), 'dentro\n');
    const homeFile = join(home, `.rice-sandbox-escrita-${id}`);
    const tmpFile = `/tmp/rice-sandbox-escrita-${id}`;
    cleanup.push(homeFile, tmpFile);
    const other = await realpath(await makeTmpDir()); // outro temporário (fora do liberado)

    const run = await sandboxed(
      [
        `echo dentro-novo > "${work}/novo.txt"; echo "escreveu_work=$?"`,
        `echo x > "${homeFile}" 2>/dev/null; echo "escreveu_home=$?"`,
        `echo x > "${tmpFile}" 2>/dev/null; echo "escreveu_tmp=$?"`,
        `echo x > "${other}/fora.txt" 2>/dev/null; echo "escreveu_outro_temp=$?"`,
        `IFS= read -r seg < "${decoyDir}/segredo.txt" 2>/dev/null; echo "leu_segredo=$? $seg"`,
        `IFS= read -r ok < "${work}/ok.txt"; echo "leu_work=$? $ok"`,
        `/usr/bin/true 2>/dev/null; echo "rodou_comando=$?"`,
        `/bin/echo oi 2>/dev/null; echo "rodou_echo=$?"`,
      ].join('\n'),
      work,
      home,
    );
    expect(run.out).toContain('escreveu_work=0'); // o temporário vazio funciona
    expect(await readFile(join(work, 'novo.txt'), 'utf8')).toBe('dentro-novo\n');
    for (const denied of ['escreveu_home', 'escreveu_tmp', 'escreveu_outro_temp', 'leu_segredo', 'rodou_comando', 'rodou_echo']) expect(run.out, denied).not.toContain(`${denied}=0`);
    expect(run.out).not.toContain('DECOY-SEGREDO');
    expect(run.out).toContain('leu_work=0');
    expect(run.out).toContain('dentro');
    // e no disco: nada foi criado fora do temporário
    await expect(stat(homeFile)).rejects.toThrow();
    await expect(stat(tmpFile)).rejects.toThrow();
    await expect(stat(join(other, 'fora.txt'))).rejects.toThrow();
  });

  test('o único processo liberado é o do próprio agy: um segundo binário não executa nem por caminho absoluto', async () => {
    const work = await realpath(await makeTmpDir());
    const r = await sandboxed(`/usr/bin/env echo x; echo "env=$?"; /bin/ls ${work} >/dev/null 2>&1; echo "ls=$?"`, work, homedir());
    expect(r.out).not.toContain('env=0');
    expect(r.out).not.toContain('ls=0');
  });
});

describe('runner (agy falso, sem o sandbox-exec)', () => {
  const make = async (over: Record<string, unknown> = {}) => {
    const workDir = await makeTmpDir();
    const home = await makeTmpDir();
    return { workDir, home, runner: createAgyRunner({ binary: FAKE_AGY, workDir, home, noSandbox: true, ...over }) };
  };
  const drain = async (g: AsyncGenerator<string, string, void>) => {
    const parts: string[] = [];
    for (;;) {
      const s = await g.next();
      if (s.done) return { parts, text: s.value };
      parts.push(s.value);
    }
  };

  test('streaming: entrega os pedaços e devolve o texto; prompt pelo stdin; cwd é um temporário vazio que some depois', async () => {
    const { runner, workDir } = await make({ model: 'gemini-3.8-flash-low' });
    process.env.FAKE_AGY_RECORD = join(workDir, 'rec.jsonl');
    const r = await drain(runner.run({ system: 'SISTEMA', prompt: 'PERGUNTA' }));
    expect(r.parts.join('')).toContain('Olá, mundo');
    expect(r.text).toContain('Olá, mundo');
    const rec = (await readFile(join(workDir, 'rec.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(rec[0].argv).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', 'gemini-3.8-flash-low', '--print-timeout', '300s']);
    const sent = JSON.parse(rec[1].stdin);
    expect(sent.event).toBe('user');
    expect(sent.message.content).toContain('SISTEMA');
    expect(sent.message.content).toContain('PERGUNTA');
    expect(rec[0].cwd).toContain('agy-cwd/run-');
    expect(await readdir(join(workDir, 'agy-cwd'))).toEqual([]); // temporário e perfil removidos
  });

  test('texto que chega inteiro (sem pedaços) também funciona', async () => {
    process.env.FAKE_AGY_MODE = 'done-only';
    const { runner } = await make();
    const r = await drain(runner.run({ system: 's', prompt: 'p' }));
    expect(r.text).toBe('Resposta inteira de uma vez.\n');
  });

  test('tentativas de ferramenta do agente não viram texto', async () => {
    process.env.FAKE_AGY_MODE = 'tools';
    const { runner } = await make();
    expect((await drain(runner.run({ system: 's', prompt: 'p' }))).text).toContain('Olá, mundo');
  });

  test('cota esgotada vira erro de limite de uso; binário ausente vira "não instalado"', async () => {
    process.env.FAKE_AGY_MODE = 'quota';
    const { runner } = await make();
    const err = await drain(runner.run({ system: 's', prompt: 'p' })).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).kind).toBe('rate-limit');
    const { runner: missing } = await make({ binary: '/nao/existe/agy' });
    const err2 = await drain(missing.run({ system: 's', prompt: 'p' })).catch((e) => e);
    expect((err2 as AiError).kind).toBe('not-installed');
  });

  test('apaga só os rastros da conversa que a chamada criou (e só com id em formato UUID)', async () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    process.env.FAKE_AGY_ID = id;
    const { runner, home } = await make();
    const base = join(home, '.gemini', 'antigravity-cli');
    for (const [dir, file] of [['conversations', `${id}.db`], ['presence', `${id}.lock`], ['annotations', `${id}.pbtxt`], ['conversations', 'outra.db']] as const) {
      await mkdir(join(base, dir), { recursive: true });
      await writeFile(join(base, dir, file), 'x');
    }
    await mkdir(join(base, 'brain', id), { recursive: true });
    await writeFile(join(base, 'brain', id, 'plano.md'), 'x');
    await mkdir(join(base, 'brain', 'de-outra-conversa'), { recursive: true });
    await drain(runner.run({ system: 's', prompt: 'p' }));
    expect(await readdir(join(base, 'conversations'))).toEqual(['outra.db']); // a do usuário fica
    expect(await readdir(join(base, 'brain'))).toEqual(['de-outra-conversa']);
    expect(await readdir(join(base, 'presence'))).toEqual([]);
    await cleanupAgyConversation('../../etc', home); // id inválido: não faz nada
    expect(await readdir(join(base, 'conversations'))).toEqual(['outra.db']);
  });
});

describe('modelos e saída', () => {
  test('parseia `agy models` e escolhe o Flash baixo como modelo leve', () => {
    const models = parseAgyModels('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n');
    expect(models.map((m) => m.id)).toEqual(['gemini-3.8-flash-high', 'gemini-3.8-flash-low', 'claude-sonnet-4-6']);
    expect(lightestAgyModel(models)).toBe('gemini-3.8-flash-low');
    expect(lightestAgyModel([{ id: 'claude-sonnet-4-6' }])).toBeUndefined();
  });
  test('listAgyModels (agy falso)', async () => {
    const workDir = await makeTmpDir();
    const models = await listAgyModels({ binary: FAKE_AGY, workDir, noSandbox: true });
    expect(models.map((m) => m.id)).toContain('claude-sonnet-4-6');
  });
  test('o parser reconhece erro, pedaços, texto inteiro e ignora o resto', () => {
    const seen: string[] = [];
    const parse = makeAgyParser((id) => seen.push(id));
    expect(parse('lixo')).toBeNull();
    expect(parse(JSON.stringify({ event: 'init', conversation_id: 'não-é-uuid' }))).toEqual({});
    expect(seen).toEqual([]); // id inválido nunca vira caminho
    expect(parse(JSON.stringify({ event: 'step_update', step_update: { step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'a' } }))).toEqual({ delta: 'a' });
    expect(parse(JSON.stringify({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'agent_response', text_delta: 'a\n' } }))).toEqual({}); // já saiu em pedaços
    expect(parse(JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'boom' } }))).toEqual({ error: 'boom', done: true });
  });
});
void chmod;
