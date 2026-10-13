#!/usr/bin/env node
// Prints da tela PAUSADA em pt/en, claro/escuro e larguras 420, 820 (equivale ao zoom 1,44 numa janela de 1180) e 1100, com a
// checagem de que a faixa do topo e a barra lateral não quebram nem cortam botões. Instância isolada e invisível.
// Uso: RICE_PERF_WAV=<wav> node scripts/perf/pause-shots.mjs <saida-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '.superpowers/polish-session');
mkdirSync(out, { recursive: true });
if (!process.env.RICE_PERF_WAV) throw new Error('defina RICE_PERF_WAV');
const app = await launch({
  settings: { uiLanguage: 'pt-BR', transcriptionLanguage: 'pt', keepAudio: false },
  size: [1100, 720],
  env: {
    RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'),
    RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'),
    FAKE_WHISPER_LINES: JSON.stringify(['Bom dia pessoal, vamos começar.', 'Primeiro, o status do trimestre.', 'A receita cresceu doze por cento.', 'Agora vamos falar do orçamento.']),
  },
});
const report = {};
const WIDTHS = [[420, 'estreita-420'], [820, 'zoom-1.44'], [1100, 'larga-1100']];
const check = `(() => {
  const bar = document.getElementById('rec-bar').getBoundingClientRect();
  const buttons = [...document.querySelectorAll('#rec-bar > *:not([hidden])')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 30) }; });
  const overflowing = buttons.filter((b) => b.w > 0 && (b.right > bar.right + 1 || b.left < bar.left - 1)); // oculto (largura 0) não conta
  const wrapped = buttons.filter((b) => b.h > 40); // nenhum botão quebra em duas linhas
  const side = document.getElementById('live-item');
  return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, barClip: false, overflowing, wrapped, buttons, live: side && !side.hidden ? side.querySelector('.live-text').textContent : null, liveDotPaused: side ? side.querySelector('.live-dot')?.classList.contains('paused') : null, listDotPaused: [...document.querySelectorAll('.meeting .live-dot')].map((d) => d.classList.contains('paused')), pauseLabel: document.getElementById('pause').textContent, pauseTitle: document.getElementById('pause').title };
})()`;
try {
  const started = await app.eval(`window.rice.startRecording({ title: 'Planejamento do trimestre' })`);
  await app.eval(`openMeeting(${JSON.stringify(started.dir)}); 0`);
  await app.sleep(1500);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  await app.sleep(9000);
  await app.eval(`document.getElementById('pause').click(); 0`);
  await app.sleep(3500);
  for (const lang of ['pt-BR', 'en']) {
    await app.eval(`window.rice.setUiLanguage(${JSON.stringify(lang)}); 0`);
    await app.sleep(1500);
    for (const scheme of ['light', 'dark']) {
      await app.theme(scheme);
      for (const [width, name] of WIDTHS) {
        await app.setSize(width, 720);
        if (width < 500) await app.eval(`document.body.classList.remove('chat-open'); document.getElementById('chat-toggle').setAttribute('aria-expanded', 'false'); 0`); // janela estreita: o painel do chat fica fechado para ver a faixa
        await app.sleep(1300);
        const key = `${lang}-${scheme}-${name}`;
        report[key] = await app.eval(check);
        await app.shot(join(out, `pausado-${key}.png`));
      }
    }
  }
  await app.setSize(1100, 720);
  await app.eval(`window.rice.setUiLanguage('pt-BR'); 0`);
  await app.theme('dark');
  await app.sleep(1000);
  await app.eval(`document.getElementById('pause').click(); 0`); // continua: o ponto volta a vermelho e pulsa
  await app.sleep(1500);
  report.resumed = await app.eval(check);
  await app.shot(join(out, 'gravando-retomado-dark-1100.png'));
  await app.eval(`window.rice.stopRecording()`);
  await app.sleep(2500);
} finally {
  await app.close();
  writeFileSync(join(out, 'pausado-layout.json'), JSON.stringify(report, null, 2));
  const bad = Object.entries(report).filter(([, r]) => r.scrollW !== r.innerW || r.barClip || r.overflowing.length || r.wrapped.length);
  console.log(JSON.stringify({ cenas: Object.keys(report).length, problemas: bad.map(([k, r]) => ({ k, overflowing: r.overflowing, wrapped: r.wrapped, barClip: r.barClip, scroll: [r.scrollW, r.innerW] })) }, null, 1));
}
