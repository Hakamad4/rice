import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './cdp-app.mjs';
const out = process.argv[2] ?? '.superpowers/chat-model';
const app = await launch({
  settings: { ai: { provider: 'claude-sub', models: { 'claude-sub': 'claude-sonnet-5-5' }, verified: { 'claude-sub': true, 'chatgpt-sub': true, 'opencode-sub': true } } },
  size: [1280, 780],
  seed: (root) => {
    const dir = join(root, '2026-10-09 1000 - Kickoff Acme');
    mkdirSync(dir);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 'x', title: 'Kickoff Acme', startedAt: '2026-10-09T10:00:00-03:00', endedAt: '2026-10-09T10:40:00-03:00', state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [] }));
    writeFileSync(join(dir, 'transcricao.md'), '# T\n\n**[10:00:05] Eu:** Vamos fechar o orçamento hoje.\n\n');
    writeFileSync(join(dir, 'notas.md'), '## Resumo\n\nOrçamento fechado.\n');
  },
});
try {
  await app.sleep(1500);
  await app.eval(`window.dispatchEvent(new CustomEvent('rice:ai-changed')); 0`);
  await app.eval(`document.querySelector('.meeting')?.click()`);
  await app.sleep(1200);
  if (!(await app.eval(`document.body.classList.contains('chat-open')`))) await app.eval(`document.getElementById('chat-toggle').click()`);
  await app.sleep(800);
  for (const scheme of ['dark', 'light']) {
    await app.theme(scheme);
    await app.sleep(400);
    await app.shot(`${out}/chip-fechado-${scheme}.png`, { x: 900, y: 0, width: 380, height: 160 });
    await app.eval(`document.getElementById('ai-via').click()`);
    await app.sleep(4000);
    console.log('menu?', await app.eval(`document.querySelectorAll('.action-menu').length`), await app.eval(`document.getElementById('ai-via').textContent`));
    await app.shot(`${out}/menu-${scheme}.png`, { x: 640, y: 0, width: 640, height: 700 });
    await app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await app.sleep(300);
  }
  // chat de todas as reuniões
  await app.theme('dark');
  await app.eval(`document.getElementById('scope-chip').click()`);
  await app.sleep(500);
  await app.shot(`${out}/escopo-menu.png`, { x: 640, y: 0, width: 640, height: 400 });
  await app.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
} finally { await app.close(); }
