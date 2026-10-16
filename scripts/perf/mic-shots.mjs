#!/usr/bin/env node
// Prints do microfone no Mac (pt/en, claro/escuro, 1000 / 820 = zoom 1,44 / 420): chip "detectado", menu de troca, aviso de mic mudo e
// Configurações › Áudio. Instância isolada e invisível, áudio e transcrição falsos (nada do Rice do usuário).
// Uso: RICE_PERF_WAV=<wav> node scripts/perf/mic-shots.mjs <saida-dir>
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '.superpowers/mic-detect');
const only = process.argv[3]; // 'menu': só o menu de troca
mkdirSync(out, { recursive: true });
if (!process.env.RICE_PERF_WAV) throw new Error('defina RICE_PERF_WAV');
const INPUTS = JSON.stringify([
  { id: 'u-builtin', name: 'Microfone do MacBook Pro', isDefault: true },
  { id: 'u-airpods', name: 'AirPods de Ana' },
  { id: 'u-fifine', name: 'fifine Microphone' },
]);
const MIC = JSON.stringify({ id: 'u-airpods', name: 'AirPods de Ana', isDefault: false, chosen: false, detected: true });
for (const lang of ['pt-BR', 'en']) {
  const app = await launch({
    settings: { uiLanguage: lang, transcriptionLanguage: lang === 'en' ? 'en' : 'pt', keepAudio: false },
    size: [1000, 720],
    env: {
      RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'),
      RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'),
      FAKE_WHISPER_LINES: JSON.stringify(['Bom dia pessoal, vamos começar.', 'Primeiro, o status do trimestre.']),
      RICE_TEST_MIC: MIC,
      RICE_TEST_MIC_INPUTS: INPUTS,
      RICE_TEST_MIC_MUTE: JSON.stringify({ id: 'u-fifine', name: 'fifine Microphone', short: 'fifine Microphone' }),
    },
  });
  try {
    await app.sleep(1500);
    const started = await app.eval(`window.rice.startRecording({ title: 'Planejamento do trimestre' })`);
    await app.eval(`openMeeting(${JSON.stringify(started.dir)}); 0`);
    await app.sleep(3500); // o chip (600 ms) e o aviso de mudo (1,5 s) já chegaram
    for (const scheme of only ? [] : ['light', 'dark']) {
      await app.theme(scheme);
      for (const width of [1000, 820, 420]) {
        await app.setSize(width, 720);
        if (width < 500) await app.eval(`document.body.classList.remove('chat-open'); document.getElementById('chat-toggle').setAttribute('aria-expanded', 'false'); 0`);
        await app.sleep(500);
        const over = await app.eval(`document.documentElement.scrollWidth > window.innerWidth`);
        if (over) console.log('ROLAGEM HORIZONTAL', lang, scheme, width);
        await app.shot(join(out, `${lang === 'en' ? 'en' : 'pt'}-chip-aviso-${scheme}-${width}.png`));
      }
    }
    // menu de troca aberto (o aviso fica de fora)
    await app.setSize(1000, 720);
    await app.theme('dark');
    await app.eval(`document.querySelector('.mic-mute-toast')?.remove(); document.getElementById('mic-chip').click(); 0`);
    await app.sleep(1200);
    console.log('popovers', await app.eval(`document.querySelectorAll('.menu-popover').length`));
    await app.shot(join(out, `${lang === 'en' ? 'en' : 'pt'}-menu-dark-1000.png`));
    await app.eval(`window.RiceActionMenu.close(); 0`);
    // trocou: o chip passa a "escolhido" (sem "detectado")
    await app.eval(`window.rice.micSwitch('u-fifine'); 0`);
    await app.sleep(500);
    await app.shot(join(out, `${lang === 'en' ? 'en' : 'pt'}-chip-trocado-dark-1000.png`));
    if (only) continue;
    // Configurações › Áudio
    await app.eval(`document.getElementById('settings-link').click(); 0`);
    await app.sleep(700);
    await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => /^(Áudio|Audio)$/.test(b.textContent.trim())).click(); 0`);
    await app.sleep(700);
    for (const scheme of ['light', 'dark']) {
      await app.theme(scheme);
      for (const width of [1000, 420]) {
        await app.setSize(width, 720);
        await app.sleep(450);
        if (await app.eval(`document.documentElement.scrollWidth > window.innerWidth`)) console.log('ROLAGEM HORIZONTAL (Áudio)', lang, scheme, width);
        await app.shot(join(out, `${lang === 'en' ? 'en' : 'pt'}-audio-${scheme}-${width}.png`));
      }
    }
  } finally {
    await app.close();
  }
}
console.log('prints em', out);
