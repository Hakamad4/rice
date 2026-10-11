// Screenshots do painel de chat em várias larguras, modos (reunião / todas) e idiomas, e checagem de overflow horizontal.
// Uso: node scripts/perf/chat-panel-shots.mjs <saida-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/chat-panel');
mkdirSync(out, { recursive: true });
const app = await launch({
  settings: { ai: { provider: 'opencode-sub', models: { 'opencode-sub': 'opencode/big-pickle' }, verified: { 'claude-sub': true, 'opencode-sub': true } } },
  size: [900, 760],
  seed: (root) => {
    const dir = join(root, '2026-10-09 1000 - Kickoff Acme');
    mkdirSync(dir);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 'x', title: 'Kickoff Acme', startedAt: '2026-10-09T10:00:00-03:00', endedAt: '2026-10-09T10:40:00-03:00', state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [] }));
    writeFileSync(join(dir, 'transcricao.md'), '# T\n\n**[10:00:05] Eu:** Vamos fechar o orçamento hoje.\n\n');
    writeFileSync(join(dir, 'notas.md'), '## Resumo\n\nOrçamento fechado.\n');
  },
});
const report = {};
/** Conversa de exemplo com texto longo e link/código sem quebra, para provocar overflow. */
const fill = (global) => `(() => {
  const box = document.getElementById(${global ? "'messages-global'" : "'messages'"});
  box.replaceChildren();
  const add = (q, a) => {
    if (window.addChatTurnForShots) return window.addChatTurnForShots(box, q, a);
    const qn = document.createElement('p'); qn.className = 'msg user'; qn.textContent = q;
    const an = document.createElement('div'); an.className = 'msg rice'; an.append(window.RiceMarkdown.renderMarkdown(a, document));
    box.append(qn, an);
  };
  add('Qual foi a última reunião e o que ficou decidido sobre o orçamento?', 'A última reunião foi **Kickoff Acme** [1]. Decidiu-se fechar o orçamento hoje e revisar as premissas de custo até sexta. Veja https://exemplo.com/um/caminho/muito/longo/que/nao/quebra/em/lugar/nenhum/mesmo/sendo/gigante e \`um_identificador_muito_longo_sem_espacos_que_estoura_a_coluna_do_painel\`.');
  add('E o que fica para a próxima?', 'Falta confirmar o fornecedor e o prazo de entrega.');
  return 0;
})()`;

async function measure(label, width) {
  await app.setSize(width, 760);
  await app.sleep(500);
  const m = await app.eval(`({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, bodyScrollW: document.body.scrollWidth, chatW: document.getElementById('chat').getBoundingClientRect().width, chatScrollW: document.getElementById('chat').scrollWidth, chatClientW: document.getElementById('chat').clientWidth, bad: [...document.querySelectorAll('#chat *')].filter((e) => e.getBoundingClientRect().right > document.getElementById('chat').getBoundingClientRect().right + 0.5).slice(0, 6).map((e) => e.tagName + '#' + e.id + '.' + e.className) })`);
  report[label] = { ...m, ok: m.scrollW === m.innerW && m.chatScrollW <= m.chatClientW };
  return m;
}

try {
  await app.eval(`document.querySelector('.meeting')?.click()`);
  await app.sleep(1500);
  await app.eval(`if (!document.body.classList.contains('chat-open')) document.getElementById('chat-toggle').click(); 0`);
  await app.sleep(800);
  for (const lang of ['pt-BR', 'en']) {
    await app.eval(`window.RiceI18n.setLanguage(${JSON.stringify(lang)}); window.RiceI18n.applyDom(); 0`);
    for (const mode of ['reuniao', 'todas']) {
      await app.eval(`setScope({ kind: ${mode === 'todas' ? "'all'" : "'meeting'"} }, false); 0`);
      await app.sleep(900);
      await app.eval(fill(mode === 'todas'));
      await app.sleep(500);
      for (const chat of [280, 320, 420]) {
        await app.eval(`document.documentElement.style.setProperty('--chat-w', '${chat}px'); 0`);
        await measure(`${lang}-${mode}-painel-${chat}-janela-900`, 900);
        await app.shot(join(out, `${lang}-${mode}-painel-${chat}-janela-900.png`), { x: 900 - chat - 40, y: 0, width: chat + 40, height: 760 });
      }
      await app.eval(`document.documentElement.style.setProperty('--chat-w', '320px'); 0`);
      await measure(`${lang}-${mode}-painel-320-janela-1200`, 1200);
      await app.setSize(900, 760);
      await app.sleep(300);
      await app.shot(join(out, `${lang}-${mode}-janela-900-inteira.png`));
    }
  }
  writeFileSync(join(out, 'overflow.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await app.close();
}
