#!/usr/bin/env node
// Prints do hover dentro do cartão "O que lembrar" (claro/escuro; larguras 1000, 820 = zoom 1,44 e 420), com mouse de verdade (CDP) sobre o botão
// do cartão, o nome da pessoa e o link da reunião. Mede também se o texto pula ao entrar no hover. Instância isolada e invisível.
// Uso: node scripts/perf/mem-hover-shots.mjs <saida-dir> <prefixo: antes|depois>
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/what-to-remember-hover');
const phase = process.argv[3] ?? 'depois';
mkdirSync(out, { recursive: true });
const BRIEF = {
  bullets: [
    { kind: 'commitment', who: 'Ana Silva', text: 'Enviar a proposta revisada com o preço por assento', due: '2026-10-20', dir: '/x/a', title: '1:1 com Ana', date: '2026-10-10', done: false },
    { kind: 'request', who: 'Carlos', text: 'Rodar o piloto com cinco clientes antes da integração', due: null, dir: '/x/b', title: 'Planejamento do trimestre', date: '2026-10-08', done: false },
    { kind: 'fact', who: 'Eu', org: 'Acme', text: 'O cliente pediu preço por assento até 30 de novembro', due: null, dir: '/x/c', title: 'Negociação Acme', date: '2026-10-05', done: false },
  ],
  recent: [{ dir: '/x/d', title: 'Revisão do contrato Acme', date: '2026-10-12' }, { dir: '/x/e', title: 'Kickoff da campanha', date: '2026-10-09' }],
};
const app = await launch({ settings: { uiLanguage: 'pt-BR', transcriptionLanguage: 'pt', keepAudio: false }, size: [1000, 720] });
try {
  await app.sleep(2000);
  await app.eval(`(() => {
    const page = document.querySelector('#detail .page');
    page.replaceChildren();
    const h = document.createElement('h1'); h.className = 'page-title'; h.textContent = '1:1 com Ana'; page.append(h);
    const card = window.RiceMemory.card({ rice: { memoryBriefMeeting: async () => (${JSON.stringify(BRIEF)}) }, dir: '/x/self', onOpen() {}, onPerson() {} });
    page.append(card.node);
    return card.load().then(() => true);
  })()`);
  await app.sleep(600);
  const TARGETS = { botao: '.mem-toggle', pessoa: '.mem-who', reuniao: '.mem-bullet .mem-src' };
  const rect = (sel) => app.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); const t = (e.querySelector('span') || e).getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, tx: t.x, ty: t.y }); })()`).then(JSON.parse);
  for (const scheme of ['light', 'dark']) {
    await app.theme(scheme);
    for (const width of [1000, 820, 420]) {
      await app.setSize(width, 720);
      await app.eval(`document.body.classList.remove('chat-open'); 0`);
      await app.sleep(500);
      for (const [name, sel] of Object.entries(TARGETS)) {
        await app.hover(2, 2);
        await app.sleep(150);
        const idle = await rect(sel);
        await app.hover(idle.x + idle.w / 2, idle.y + idle.h / 2);
        await app.sleep(250);
        const hov = await rect(sel);
        const jump = Math.abs(hov.tx - idle.tx) + Math.abs(hov.ty - idle.ty);
        const card = await rect('.mem-card');
        console.log(`${phase} ${scheme} ${width} ${name}: texto pula ${jump.toFixed(1)} px; botão ${Math.round(idle.w)}x${Math.round(idle.h)}`);
        await app.shot(join(out, `${phase}-${name}-${scheme}-${width}.png`), { x: Math.max(0, card.x - 12), y: Math.max(0, card.y - 12), width: Math.min(width, card.w + 24), height: card.h + 24 });
      }
    }
  }
} finally {
  await app.close();
}
console.log('prints em', out);
