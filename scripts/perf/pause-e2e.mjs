#!/usr/bin/env node
// Pausar a gravação de ponta a ponta numa instância ISOLADA e invisível (mock keychain, dados fictícios, whisper e áudio falsos):
// grava, pausa pelo botão, confere que nada é transcrito pausado, continua e confere o marcador, a lacuna no meta e o relógio.
// Uso: RICE_PERF_WAV=<wav 16 kHz mono s16le> node scripts/perf/pause-e2e.mjs <saida-dir> [pausa-em-segundos]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '.superpowers/polish-session');
const pauseSeconds = Number(process.argv[3] ?? 70);
mkdirSync(out, { recursive: true });
if (!process.env.RICE_PERF_WAV) throw new Error('defina RICE_PERF_WAV');

const app = await launch({
  settings: { uiLanguage: 'pt-BR', transcriptionLanguage: 'pt', keepAudio: false },
  size: [1180, 760],
  env: {
    RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'),
    RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'),
    FAKE_WHISPER_LINES: JSON.stringify(['Bom dia pessoal, vamos começar.', 'Primeiro, o status do trimestre.', 'A receita cresceu doze por cento.', 'Agora vamos falar do orçamento.', 'A pesquisa está abaixo do orçado.', 'Combinado, fechamos por hoje.', 'Obrigado a todos.', 'Até a próxima.']),
  },
});
const sleep = app.sleep;
const report = {};
const lines = async (dir) => (await app.eval(`window.rice.readMeeting(${JSON.stringify(dir)}).then((m) => m.transcript)`)).split('\n').filter((l) => l.startsWith('**['));
try {
  const started = await app.eval(`window.rice.startRecording({ title: 'Planejamento do trimestre' })`);
  const dir = started.dir;
  await app.eval(`openMeeting(${JSON.stringify(dir)}); 0`);
  await sleep(1500);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  await sleep(17000);
  report.beforePause = { lines: (await lines(dir)).length, pauseButton: await app.eval(`document.getElementById('pause').textContent`) };
  await app.shot(join(out, 'pausado-1-gravando-antes.png'));

  await app.eval(`document.getElementById('pause').click(); 0`); // botão "Pausar"
  await sleep(2500);
  const atPause = (await lines(dir)).length;
  report.paused = await app.eval(`({ button: document.getElementById('pause').textContent, live: document.querySelector('#live-item .live-text')?.textContent, state: window.rice.sessionState() })`);
  await app.shot(join(out, 'pausado-2-pausado-e2e.png'));
  const clockPaused = report.paused.live; // pausado: "Pausado · título · 00:18"
  await sleep(pauseSeconds * 1000);
  report.pausedStayedQuiet = (await lines(dir)).length === atPause;
  report.clockFrozen = (await app.eval(`document.querySelector('#live-item .live-text')?.textContent`)) === clockPaused;

  await app.eval(`document.getElementById('pause').click(); 0`); // "Continuar"
  await sleep(1500);
  report.resumed = await app.eval(`({ button: document.getElementById('pause').textContent })`);
  await sleep(17000);
  await app.shot(join(out, 'pausado-marcador-transcricao.png'));
  report.liveMarker = await app.eval(`[...document.querySelectorAll('.transcript .t-gap')].map((r) => r.textContent)`);
  await app.eval(`window.rice.stopRecording()`);
  await sleep(4000);
  const transcript = readFileSync(join(app.root, readdirNames(app.root)[0], 'transcricao.md'), 'utf8');
  report.fileMarker = transcript.split('\n').filter((l) => /pausad[ao]/.test(l));
  report.linesAfter = (await lines(dir)).length;
  const meta = JSON.parse(readFileSync(join(app.root, readdirNames(app.root)[0], 'meta.json'), 'utf8'));
  report.gaps = meta.gaps;
  report.state = meta.state;
} finally {
  await app.close();
  writeFileSync(join(out, 'pausa-e2e.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}

function readdirNames(dir) {
  return readdirSync(dir).filter((n) => !n.startsWith('.'));
}
