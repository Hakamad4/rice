// Sobe uma instância ISOLADA e invisível do Rice (RICE_BENCH=1, --user-data-dir temporário) e devolve um controle por CDP:
// eval, screenshot (com tema claro/escuro) e encerramento só do PID iniciado aqui.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ settings = {}, env = {}, size = [1180, 760], seed } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'rice-shot-'));
  const userData = join(tmp, 'ud');
  const root = join(tmp, 'R');
  mkdirSync(userData);
  mkdirSync(root);
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ root, keepAudio: false, onboardingDone: true, calendarAsked: true, transcriptionLanguage: 'pt', ...settings }));
  if (seed) seed(root); // reuniões de teste na pasta antes do app abrir
  const port = 9200 + Math.floor(Math.random() * 90);
  const child = spawn(join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [repo, "--use-mock-keychain", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, RICE_BENCH: '1', RICE_DETECTOR_BIN: join(repo, 'tests/fixtures/fake-rice-detector.mjs'), ...env },
    stdio: process.env.RICE_E2E_LOG ? ['ignore', openSync(process.env.RICE_E2E_LOG, 'a'), openSync(process.env.RICE_E2E_LOG, 'a')] : 'ignore', // RICE_E2E_LOG: guarda a saída do app para depurar
  });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json`); break; } catch { await sleep(500); } }
  await sleep(3000);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((x) => x.type === 'page' && !/nub|alert/.test(x.url)) ?? targets.find((x) => x.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 2, mobile: false });
  return {
    root,
    eval: async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value,
    setSize: (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false }),
    theme: (scheme) => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }),
    /** Abre outra página do app NESTA mesma janela invisível (ex.: alert.html), com um script que roda antes dos da página (para simular o preload). */
    navigate: async (url, beforeScript) => {
      await send('Page.enable');
      if (beforeScript) await send('Page.addScriptToEvaluateOnNewDocument', { source: beforeScript });
      await send('Page.navigate', { url });
      await sleep(1500);
    },
    /** Relógio fixo da página (reproduzível): `Date` passa a andar a partir de `fixedMs` em todas as páginas abertas daqui em diante; recarrega a atual. */
    clock: async (fixedMs) => {
      await send('Page.enable');
      const source = `(() => { const R = Date; const off = ${fixedMs} - R.now(); class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } } window.Date = D; })();`;
      await send('Page.addScriptToEvaluateOnNewDocument', { source });
      await send('Page.reload');
      await sleep(2500);
    },
    shot: async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    sleep,
    close: async () => {
      ws.close();
      child.kill('SIGTERM'); // só o PID iniciado aqui
      await sleep(5000);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
}
