// Smoke test do app: sobe o Electron (instância de teste invisível, dados isolados) com os helpers nativos em modo simulado,
// abre o Início pelo protocolo de depuração e confere o essencial. Roda no macOS e no Windows (CI); sem rede, sem agenda nem credenciais reais.
//   node scripts/smoke.mjs [--expect-platform darwin|win32]
// Variáveis: RICE_AUDIO_BIN / RICE_DETECTOR_BIN (helpers; o CI aponta para build/win), RICE_SMOKE_PORT (padrão 9334).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electron = require('electron');
const expectIdx = process.argv.indexOf('--expect-platform');
const expectPlatform = expectIdx > 0 ? process.argv[expectIdx + 1] : process.platform;
const port = Number(process.env.RICE_SMOKE_PORT || 9334);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = mkdtempSync(join(tmpdir(), 'rice-smoke-'));
const userData = join(base, 'data');
const root = join(base, 'Rice');
mkdirSync(userData, { recursive: true });
mkdirSync(root, { recursive: true });
// onboarding já feito e pasta de reuniões isolada: o app abre direto no Início
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, onboardingDone: true, uiLanguage: 'pt-BR', keepAudio: true }));

const args = ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`];
if (process.platform === 'darwin') args.push('--use-mock-keychain'); // nunca tocar no Keychain do usuário
const child = spawn(electron, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    RICE_BENCH: '1', // janela invisível
    RICE_AUDIO_SIMULATE: '1', // helper de áudio: tons sintéticos
    RICE_DETECTOR_FAKE_MIC_STEPS: '[[],[]]', // helper detector: nenhum app usando o microfone
    ...(expectPlatform === 'win32' && process.platform !== 'win32' ? { RICE_FAKE_PLATFORM: 'win32' } : {}),
  },
});
let log = '';
for (const s of [child.stdout, child.stderr]) s.on('data', (d) => (log = (log + d).slice(-6000)));
let exited = null;
child.on('exit', (code) => (exited = code ?? 'signal'));

function stop() {
  try {
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {
    // já saiu
  }
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    // o Windows pode segurar arquivos por um instante
  }
}

async function pageSocket() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`o app saiu antes de abrir a janela (código ${exited})\n${log}`);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // ainda subindo
    }
    await sleep(500);
  }
  throw new Error(`a janela não abriu em 60 s\n${log}`);
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const opened = new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = () => rej(new Error('WebSocket CDP falhou')))));
  const evaluate = async (expression) => {
    await opened;
    const n = ++id;
    const reply = new Promise((r) => pending.set(n, r));
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    const msg = await reply;
    if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.text + ' ' + (msg.result.exceptionDetails.exception?.description ?? ''));
    return msg.result?.result?.value;
  };
  return { evaluate, close: () => ws.close() };
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

try {
  const cdp = client(await pageSocket());
  // espera o Início: a coluna central com a página, o botão de gravar e a lista de reuniões
  let home = null;
  for (let i = 0; i < 60 && !home?.page; i++) {
    home = await cdp.evaluate(`(() => ({ page: Boolean(document.querySelector('#detail .page')), rec: Boolean(document.getElementById('rec')), text: document.getElementById('detail')?.innerText.slice(0, 400) ?? '' }))()`).catch(() => null);
    if (!home?.page) await sleep(500);
  }
  check('Início aberto (#detail .page)', home?.page, home?.text);
  check('botão Gravar presente', home?.rec);
  const info = await cdp.evaluate(`({ platform: window.rice.platform, win: document.body.classList.contains('platform-win'), traffic: getComputedStyle(document.documentElement).getPropertyValue('--traffic').trim(), overlay: getComputedStyle(document.documentElement).getPropertyValue('--overlay-r').trim(), horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  check(`plataforma do renderer = ${expectPlatform}`, info.platform === expectPlatform, JSON.stringify(info));
  check('classe platform-win só no Windows', info.win === (expectPlatform === 'win32'));
  check('sem espaço dos semáforos no Windows (--traffic 12px)', expectPlatform !== 'win32' || info.traffic === '12px', info.traffic);
  check('sem rolagem horizontal', !info.horizontalScroll);
  const text = await cdp.evaluate(`document.body.innerText`);
  check('sem "undefined" nem chave de tradução na tela', !/\bundefined\b|\b[a-z]+\.[a-z-]+\.[a-z-]+\b(?=\s|$)/.test(text.replace(/https?:\S+|\S+@\S+|\d+\.\d+/g, '')), text.slice(0, 200));
  if (expectPlatform === 'win32') check('texto do Windows: nada de "Finder" nem "Keychain" no Início', !/Finder|Keychain/.test(text));
  cdp.close();
} catch (err) {
  check('execução', false, String(err.message ?? err));
} finally {
  stop();
}

for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FALHA'} ${r.name}${r.ok ? '' : ` -> ${r.detail}`}`);
if (results.some((r) => !r.ok)) {
  console.log('--- saída do app ---\n' + log);
  process.exit(1);
}
