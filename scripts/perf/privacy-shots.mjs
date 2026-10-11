// Screenshots da seção "Privacidade e segurança" (Configurações) e do passo do tutorial.
// Uso: node scripts/perf/privacy-shots.mjs <saida-dir>
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/security');
mkdirSync(out, { recursive: true });
const cases = [
  ['claude', { ai: { provider: 'claude-sub', models: { 'claude-sub': 'claude-sonnet-5-5' }, verified: { 'claude-sub': true } } }],
  ['opencode-gratuito', { ai: { provider: 'opencode-sub', models: { 'opencode-sub': 'opencode/big-pickle' }, verified: { 'opencode-sub': true } } }],
];
for (const [name, settings] of cases) {
  const app = await launch({ settings, size: [1100, 900] });
  try {
    await app.eval(`document.getElementById('settings-link').click()`);
    await app.sleep(2500);
    await app.eval(`[...document.querySelectorAll('.setting-section')].at(-1).scrollIntoView({ block: 'start' }); 0`);
    await app.sleep(500);
    for (const scheme of ['dark', 'light']) {
      await app.theme(scheme);
      await app.sleep(400);
      await app.shot(join(out, `configuracoes-privacidade-${name}-${scheme}.png`));
    }
    if (name === 'claude') {
      await app.eval(`document.getElementById('guide-link').click()`);
      await app.sleep(2500);
      await app.eval(`[...document.querySelectorAll('.step')].find((s) => s.querySelector('h3').textContent === 'Privacidade').scrollIntoView({ block: 'center' }); 0`);
      await app.theme('dark');
      await app.sleep(400);
      await app.shot(join(out, 'tutorial-privacidade-dark.png'));
    }
  } finally {
    await app.close();
  }
}
