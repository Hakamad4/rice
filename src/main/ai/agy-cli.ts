import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { t } from '../i18n';
import { buildChildEnv } from './env';
import { runCli, type CliLine } from './cli-run';
import type { AiRunner } from './types';

/** O sandbox-exec do macOS (obsoleto, mas presente e estável desde sempre). */
export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export const AGY_MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Aspas para o formato de perfil do Seatbelt: só permite caminhos "normais" (sem aspas, quebra de linha ou parênteses de controle). */
const q = (path: string): string => {
  if (!path.startsWith('/') || /["\\\n\r\u0000]/.test(path)) throw new Error('invalid path for the sandbox profile');
  return `"${path}"`;
};

export type AgyProfileInput = {
  /** Caminho REAL do executável `agy` (o único processo que pode rodar, além do `security`). */
  agy: string;
  /** Diretório temporário e vazio onde o agy roda: a ÚNICA pasta em que ele pode escrever (fora o próprio estado). */
  work: string;
  home?: string;
};

/**
 * Perfil do sandbox do agy, pensado para uso SÓ TEXTO (o agy é um agente com 60 ferramentas e "permission_mode always-proceed"):
 *  - escrita em disco: negada em tudo, exceto o temporário vazio e o estado do próprio agy (`~/.gemini/antigravity*` e `config`);
 *  - leitura: a pasta pessoal inteira é negada (chaves SSH, AWS, outros apps), salvo o que o agy precisa para entrar e funcionar;
 *  - processos: nenhum `exec` além do próprio agy e de `/usr/bin/security` (o agy o usa ao iniciar para ler o login do Keychain).
 *    Sem shell, o `run_command` do agente não consegue nem criar o terminal ("failed to create PTY: operation not permitted").
 * A rede continua liberada (é por ela que o modelo responde).
 */
export function buildAgyProfile({ agy, work, home = homedir() }: AgyProfileInput): string {
  return [
    '(version 1)',
    '(allow default)',
    ';; writes: nothing, except the empty temp dir and agy own state',
    '(deny file-write*)',
    '(allow file-write*',
    `  (subpath ${q(work)})`,
    `  (subpath ${q(`${home}/.gemini/antigravity`)})`,
    `  (subpath ${q(`${home}/.gemini/antigravity-cli`)})`,
    `  (subpath ${q(`${home}/.gemini/config`)})`,
    '  (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+$") (literal "/dev/dtracehelper"))',
    ';; processes: only agy and security (login)',
    '(deny process-exec*)',
    `(allow process-exec (literal ${q(agy)}) (literal "/usr/bin/security"))`,
    ';; reads: the home folder is denied, with a few exceptions',
    `(deny file-read* (subpath ${q(home)}))`,
    '(allow file-read*',
    `  (literal ${q(home)})`,
    `  (subpath ${q(work)})`,
    `  (literal ${q(agy)})`,
    `  (subpath ${q(`${home}/.gemini/antigravity`)})`,
    `  (subpath ${q(`${home}/.gemini/antigravity-cli`)})`,
    `  (subpath ${q(`${home}/.gemini/config`)})`,
    `  (subpath ${q(`${home}/.local/bin`)})`,
    `  (subpath ${q(`${home}/Library/Keychains`)})`,
    `  (subpath ${q(`${home}/Library/Preferences`)})`,
    `  (subpath ${q(`${home}/Library/Caches`)}))`,
    '',
  ].join('\n');
}

/** Argumentos do agy: prompt pelo stdin (nunca no argv), saída em stream-json, sem flags de permissão e sem projeto do usuário. */
export function buildAgyArgs(model?: string, timeoutSec = 300): string[] {
  return [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    ...(model && AGY_MODEL_RE.test(model) ? ['--model', model] : []),
    '--print-timeout', `${timeoutSec}s`,
  ];
}

/** Uma mensagem de usuário no protocolo de entrada do agy. */
export const agyStdin = (text: string): string => `${JSON.stringify({ event: 'user', message: { content: text } })}\n`;

type Json = Record<string, any>;

/**
 * Interpreta o stream-json do agy. `init` traz o id da conversa; `step_update` traz o texto do modelo (em pedaços `ACTIVE` ou
 * inteiro em `DONE`); `result` fecha com `status` SUCCESS/ERROR. Tentativas de ferramenta aparecem como `tool`, e o sandbox as nega.
 */
export function makeAgyParser(onConversation?: (id: string) => void): (line: string) => CliLine | null {
  const streamed = new Set<number>();
  let emitted = false;
  return (line) => {
    let d: Json;
    try {
      d = JSON.parse(line);
    } catch {
      return null;
    }
    if (typeof d !== 'object' || d === null) return null;
    if (d.event === 'init') {
      const id = d.conversation_id ?? d.init?.conversation_id;
      if (typeof id === 'string' && UUID_RE.test(id)) onConversation?.(id);
      return {};
    }
    if (d.event === 'step_update' && d.step_update?.step_type === 'agent_response') {
      const s = d.step_update;
      const text = typeof s.text_delta === 'string' ? s.text_delta : '';
      if (s.state === 'ACTIVE' && text) {
        streamed.add(Number(s.step_index));
        emitted = true;
        return { delta: text };
      }
      if (s.state === 'DONE' && text.trim() && !streamed.has(Number(s.step_index))) {
        emitted = true;
        return { delta: text };
      }
      return {};
    }
    if (d.event === 'result' && d.result) {
      const r = d.result;
      if (r.status === 'ERROR' || (typeof r.error === 'string' && r.error)) return { error: String(r.error || t('ai.err.run-failed')), done: true };
      if (!emitted && typeof r.response === 'string' && r.response.trim()) return { message: r.response, done: true };
      return { done: true };
    }
    return {};
  };
}

const ARTIFACTS = ['conversations', 'presence', 'annotations', 'brain'] as const;

/** Apaga SÓ os rastros da conversa que esta chamada criou (por id validado como UUID) no estado do agy. */
export async function cleanupAgyConversation(id: string, home = homedir()): Promise<void> {
  if (!UUID_RE.test(id)) return;
  const base = join(home, '.gemini', 'antigravity-cli');
  await Promise.all([
    rm(join(base, 'conversations', `${id}.db`), { force: true }),
    rm(join(base, 'presence', `${id}.lock`), { force: true }),
    rm(join(base, 'annotations', `${id}.pbtxt`), { force: true }),
    rm(join(base, 'brain', id), { recursive: true, force: true }),
  ]).catch(() => undefined);
}
export const AGY_ARTIFACT_DIRS = ARTIFACTS;

export type AgyRunnerConfig = {
  /** Executável `agy`. */
  binary: string;
  /** Pasta do Rice para o diretório de trabalho temporário (`<workDir>/agy-cwd/…`). */
  workDir: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** SÓ PARA TESTES: roda o binário direto, sem o sandbox-exec (o binário de teste é um script). */
  noSandbox?: boolean;
  home?: string;
};

export function createAgyRunner(config: AgyRunnerConfig): AiRunner {
  return {
    run: async function* ({ system, prompt, signal }) {
      const home = config.home ?? homedir();
      const parent = join(config.workDir, 'agy-cwd');
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const work = await realpath(await mkdtemp(join(parent, 'run-')));
      let profileFile: string | null = null;
      let conversation: string | null = null;
      try {
        const env = buildChildEnv(config.env ?? process.env, {}, config.binary);
        const timeoutMs = config.timeoutMs ?? 300_000;
        let binary = config.binary;
        let args = buildAgyArgs(config.model, Math.ceil(timeoutMs / 1000));
        if (!config.noSandbox) {
          const agy = await realpath(config.binary).catch(() => config.binary);
          profileFile = join(parent, `${randomUUID()}.sb`);
          await writeFile(profileFile, buildAgyProfile({ agy, work, home }), { mode: 0o600 });
          binary = SANDBOX_EXEC;
          args = ['-f', profileFile, agy, ...args];
        }
        return yield* runCli({
          provider: 'agy-sub',
          binary,
          args,
          cwd: work,
          env,
          stdin: agyStdin(`${system}\n\n---\n\n${prompt}`),
          ...(signal ? { signal } : {}),
          parseLine: makeAgyParser((id) => (conversation = id)),
          notInstalled: t('ai.cli.agy-missing'),
          timeoutMs,
        });
      } finally {
        if (conversation) await cleanupAgyConversation(conversation, home);
        if (profileFile) await rm(profileFile, { force: true }).catch(() => undefined);
        await rm(work, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

/** Modelos que `agy models` lista (id e rótulo, separados por tab). Roda dentro do mesmo sandbox. */
export function parseAgyModels(output: string): Array<{ id: string; label: string }> {
  return output.split('\n').flatMap((line) => {
    const [id, label] = line.split('\t');
    return id && AGY_MODEL_RE.test(id.trim()) ? [{ id: id.trim(), label: (label ?? id).trim() }] : [];
  });
}

/** O menor modelo para etapas simples: Flash com esforço baixo, se houver. */
export function lightestAgyModel(models: ReadonlyArray<{ id: string }>): string | undefined {
  const flash = models.map((m) => m.id).filter((id) => /flash/.test(id));
  return flash.find((id) => /low$/.test(id)) ?? flash[0];
}

export async function listAgyModels(config: { binary: string; workDir: string; env?: NodeJS.ProcessEnv; noSandbox?: boolean; home?: string }): Promise<Array<{ id: string; label: string }>> {
  const home = config.home ?? homedir();
  const parent = join(config.workDir, 'agy-cwd');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const work = await realpath(await mkdtemp(join(parent, 'models-')));
  const env = buildChildEnv(config.env ?? process.env, {}, config.binary);
  const profileFile = join(parent, `${randomUUID()}.sb`);
  try {
    let binary = config.binary;
    let args = ['models'];
    if (!config.noSandbox) {
      const agy = await realpath(config.binary).catch(() => config.binary);
      await writeFile(profileFile, buildAgyProfile({ agy, work, home }), { mode: 0o600 });
      binary = SANDBOX_EXEC;
      args = ['-f', profileFile, agy, 'models'];
    }
    const out = await new Promise<string>((resolve) => execFile(binary, args, { cwd: work, env, timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? '' : String(stdout))));
    return parseAgyModels(out);
  } finally {
    await rm(profileFile, { force: true }).catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}


type ModelsConfig = { binary: string; workDir: string; env?: NodeJS.ProcessEnv; noSandbox?: boolean; home?: string };
const modelCache = new Map<string, { at: number; models: Array<{ id: string; label: string }>; pending?: Promise<void> }>();
export const AGY_MODELS_TTL_MS = 10 * 60_000;

/**
 * Lista de modelos do agy com cache (`agy models` leva ~4 s por causa da partida do agy). `wait: false` (status da tela) nunca
 * espera: devolve o que há (vazio na primeira vez) e atualiza em segundo plano; `wait: true` (uma etapa leve prestes a rodar) espera.
 */
export async function cachedAgyModels(config: ModelsConfig, wait: boolean, now: number = Date.now()): Promise<Array<{ id: string; label: string }>> {
  const key = config.binary;
  let entry = modelCache.get(key);
  if (!entry) modelCache.set(key, (entry = { at: 0, models: [] }));
  const e = entry;
  if (now - e.at >= AGY_MODELS_TTL_MS && !e.pending) {
    e.pending = listAgyModels(config)
      .then((models) => {
        if (models.length > 0) {
          e.models = models;
          e.at = now;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        e.pending = undefined;
      });
  }
  if (wait && e.pending) await e.pending;
  return e.models;
}
export const clearAgyModelsCache = (): void => modelCache.clear();
