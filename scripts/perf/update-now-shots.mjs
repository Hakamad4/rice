#!/usr/bin/env node
// Prints de Configurações › Atualizações com o botão "Buscar atualização agora" (pt/en, claro/escuro, 420 e 1000 de largura):
// estados: inicial, sem novidade, versão nova, erro de rede, verificação automática desligada e Modo 100% local. Instância isolada.
// Uso: node scripts/perf/update-now-shots.mjs <saida-dir>
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/update-now');
mkdirSync(out, { recursive: true });
const SCENES = [
  ['inicial', {}, {}, false],
  ['sem-novidade', {}, { RICE_TEST_CHECKNOW: 'latest' }, true],
  ['versao-nova', {}, { RICE_TEST_CHECKNOW: 'available', RICE_TEST_UPDATE: 'clone' }, true],
  ['erro-de-rede', {}, { RICE_TEST_CHECKNOW: 'error' }, true],
  ['automatico-desligado', { checkUpdates: false }, {}, false],
  ['modo-local', { fullyLocal: true }, {}, false],
];
for (const lang of ['pt-BR', 'en']) {
  for (const [name, settings, env, click] of SCENES) {
    const app = await launch({ settings: { uiLanguage: lang, transcriptionLanguage: lang === 'en' ? 'en' : 'pt', ...settings }, env, size: [1000, 720] });
    try {
      await app.sleep(1500);
      await app.eval(`document.getElementById('settings-link').click(); 0`);
      await app.sleep(800);
      await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => /Atualizações|Updates/.test(b.textContent)).click(); 0`);
      await app.sleep(800);
      if (click) {
        await app.eval(`document.querySelector('.update-now button').click(); 0`);
        await app.sleep(600);
      }
      for (const scheme of ['light', 'dark']) {
        await app.theme(scheme);
        for (const width of [1000, 420]) {
          await app.setSize(width, 720);
          await app.sleep(500);
          const bad = await app.eval(`document.documentElement.scrollWidth > window.innerWidth`);
          if (bad) console.log('ROLAGEM HORIZONTAL', lang, name, scheme, width);
          await app.shot(join(out, `${lang === 'en' ? 'en' : 'pt'}-${name}-${scheme}-${width}.png`));
        }
      }
    } finally {
      await app.close();
    }
  }
}
console.log('prints em', out);
