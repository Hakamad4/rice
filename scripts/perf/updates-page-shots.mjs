#!/usr/bin/env node
// Prints de Configurações › Atualizações em cada estado (Mac e Windows; pt/en, claro/escuro, larguras 1000, 820 = zoom 1,44 e 420).
// Instância isolada e invisível; os estados vêm das variáveis RICE_TEST_* (só instâncias de teste).
// Uso: node scripts/perf/updates-page-shots.mjs <saida-dir> [filtro-de-cena]
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/updates-page');
const only = process.argv[3];
mkdirSync(out, { recursive: true });
const WIN = { RICE_FAKE_PLATFORM: 'win32' };
// [nome, settings, env, clicar em "Buscar", abrir detalhes]
const SCENES = [
  ['atualizado', {}, { RICE_TEST_CHECKNOW: 'latest' }, true, false],
  ['nova-versao', {}, { RICE_TEST_UPDATE: 'clone' }, false, false],
  ['nova-versao-sem-clone', {}, { RICE_TEST_UPDATE: 'release' }, false, false],
  ['sem-conexao', {}, { RICE_TEST_CHECKNOW: 'error' }, true, false],
  ['modo-local', { fullyLocal: true }, {}, false, false],
  ['automatico-desligado', { checkUpdates: false }, { RICE_TEST_CHECKNOW: 'latest' }, true, false],
  ['detalhes', {}, { RICE_TEST_CHECKNOW: 'latest' }, true, true],
  ['win-nova', {}, { ...WIN, RICE_TEST_WINUPDATE: 'available' }, false, false],
  ['win-baixando', {}, { ...WIN, RICE_TEST_WINUPDATE: 'downloading' }, false, false],
  ['win-pronta', {}, { ...WIN, RICE_TEST_WINUPDATE: 'downloaded' }, false, false],
  ['win-aguardando', {}, { ...WIN, RICE_TEST_WINUPDATE: 'waiting' }, false, false],
];
for (const lang of ['pt-BR', 'en']) {
  for (const [name, settings, env, click, open] of SCENES) {
    if (only && !name.includes(only)) continue;
    const app = await launch({ settings: { uiLanguage: lang, transcriptionLanguage: lang === 'en' ? 'en' : 'pt', ...settings }, env: { RICE_BENCH: '1', ...env }, size: [1000, 720] });
    try {
      await app.sleep(1500);
      await app.eval(`document.getElementById('settings-link').click(); 0`);
      await app.sleep(800);
      await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => /Atualizações|Updates/.test(b.textContent)).click(); 0`);
      await app.sleep(800);
      if (click) {
        await app.eval(`document.querySelector('.upd-act button').click(); 0`);
        await app.sleep(700);
      }
      if (open) await app.eval(`document.querySelector('.upd-fold').open = true; 0`);
      for (const scheme of ['light', 'dark']) {
        await app.theme(scheme);
        for (const width of [1000, 820, 420]) {
          await app.setSize(width, 720);
          await app.sleep(450);
          if (await app.eval(`document.documentElement.scrollWidth > window.innerWidth`)) console.log('ROLAGEM HORIZONTAL', lang, name, scheme, width);
          await app.shot(join(out, `${lang === 'en' ? 'en' : 'pt'}-${name}-${scheme}-${width}.png`));
        }
      }
    } finally {
      await app.close();
    }
  }
}
console.log('prints em', out);
