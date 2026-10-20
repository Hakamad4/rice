// Mede e fotografa o botão "Tradução ao vivo" na linha das abas: altura (vs Pausar/Parar), centro vertical (vs o texto das abas) e respiro acima da divisória.
// Uso: node scripts/perf/translate-button-shots.mjs <pasta-de-saída>   (instância isolada e invisível)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '/tmp/rice-translate-btn');
mkdirSync(out, { recursive: true });
const app = await launch({
  settings: { uiLanguage: 'pt-BR', transcriptionLanguage: 'pt' },
  env: { RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'), FAKE_WHISPER_LINES: JSON.stringify(['Bom dia, pessoal, vamos começar.']) },
});
const measure = `JSON.stringify((() => {
  const vis = [...document.querySelectorAll('.tr-split')].find((s) => getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().width > 0 && !s.hidden);
  const tab = document.querySelector('.mt-tab[aria-selected="true"]');
  const tabs = document.querySelector('.mt-tabs');
  const pause = [...document.querySelectorAll('#rec-bar button')].find((b) => b.getBoundingClientRect().width > 0 && /paus/i.test(b.textContent + b.title + (b.getAttribute('aria-label') || '')));
  if (!vis) return { visible: false };
  const r = vis.getBoundingClientRect(); const tr = tab.getBoundingClientRect(); const line = tabs.getBoundingClientRect();
  const range = document.createRange(); range.selectNodeContents(tab); const text = range.getBoundingClientRect();
  return { visible: true, h: r.height, pauseH: pause ? pause.getBoundingClientRect().height : null, btnCenter: +(r.top + r.height / 2).toFixed(1), textCenter: +(text.top + text.height / 2).toFixed(1), gapAboveLine: +(line.bottom - r.bottom).toFixed(1), gapBelowTabsTop: +(r.top - line.top).toFixed(1) };
})())`;
try {
  const started = await app.eval(`window.rice.startRecording({ title: 'Alinhamento com Acme' })`);
  await app.eval(`openMeeting(${JSON.stringify(started.dir)}); 0`);
  await app.sleep(1500);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  const sizes = { normal: [1180, 760], small: [420, 760], zoom144: [820, 528] };
  for (const on of [false, true]) {
    await app.eval(`(async () => { const t = document.querySelector('.tr-split-wide .tr-btn'); const pressed = document.querySelector('.tr-btn').getAttribute('aria-pressed') === 'true'; if (pressed !== ${on}) document.querySelector('.tr-btn').click(); })(); 0`);
    await app.sleep(800);
    for (const theme of ['light', 'dark']) {
      await app.theme(theme);
      for (const [name, [w, h]] of Object.entries(sizes)) {
        await app.setSize(w, h);
        await app.eval(`document.body.classList.toggle('side-collapsed', ${name === 'small'}); document.body.classList.contains('chat-open') && document.getElementById('chat-close').click(); 0`);
        await app.sleep(700);
        console.log(`${on ? 'ligada' : 'desligada'} ${theme} ${name}:`, await app.eval(measure));
        await app.shot(join(out, `btn-${on ? 'on' : 'off'}-${theme}-${name}.png`));
      }
    }
  }
} finally {
  await app.close();
}
