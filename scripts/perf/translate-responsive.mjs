// Confere que o botão "Tradução ao vivo" aparece UMA vez em cada largura, com a barra lateral aberta e recolhida (instância isolada e invisível).
// Uso: node scripts/perf/translate-responsive.mjs <pasta-de-saída>
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '/tmp/rice-translate-resp');
mkdirSync(out, { recursive: true });
const app = await launch({
  settings: { uiLanguage: 'pt-BR', transcriptionLanguage: 'pt' },
  env: { RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'), FAKE_WHISPER_LINES: JSON.stringify(['Bom dia, pessoal, vamos começar.', 'O primeiro ponto é o cronograma.']) },
});
let bad = 0;
try {
  const started = await app.eval(`window.rice.startRecording({ title: 'Alinhamento com Acme' })`);
  await app.eval(`openMeeting(${JSON.stringify(started.dir)}); 0`);
  await app.sleep(1500);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  const sizes = { 420: [420, 760], 600: [600, 760], 800: [800, 760], zoom144: [820, 528] };
  for (const [name, [w, h]] of Object.entries(sizes)) {
    for (const side of ['aberta', 'recolhida']) {
      await app.setSize(w, h);
      await app.eval(`document.body.classList.toggle('side-collapsed', ${side === 'recolhida'}); document.body.classList.contains('chat-open') && document.getElementById('chat-close').click(); 0`);
      await app.sleep(900);
      const r = await app.eval(`JSON.stringify({ shown: [...document.querySelectorAll('.tr-split')].filter((s) => !s.hidden && getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().width > 0).length, detail: document.getElementById('detail').clientWidth })`);
      const { shown, detail } = JSON.parse(r);
      if (shown !== 1) bad++;
      console.log(`${name} px, barra ${side}: detalhe ${detail}px, botões visíveis ${shown}${shown === 1 ? '' : '  <-- ERRO'}`);
      await app.shot(join(out, `resp-${name}-${side}.png`));
    }
  }
} finally {
  await app.close();
}
process.exit(bad ? 1 : 0);
