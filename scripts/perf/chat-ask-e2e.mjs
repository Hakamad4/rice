// Pergunta REAL no chat de todas as reuniões (provedor configurado), numa instância isolada: confere que "última reunião"
// e um termo sem match recebem resposta (nunca "Não encontrei reuniões sobre isso") e tira screenshots.
// Uso: node scripts/perf/chat-ask-e2e.mjs <saida-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/chat-panel');
mkdirSync(out, { recursive: true });
const app = await launch({
  settings: { ai: { provider: 'claude-sub', models: { 'claude-sub': 'claude-haiku-5-5' }, verified: { 'claude-sub': true } } },
  size: [1100, 760],
  seed: (root) => {
    const mk = (name, title, start, notes) => {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: name, title, startedAt: start, endedAt: start, state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [] }));
      writeFileSync(join(dir, 'transcricao.md'), `# T\n\n**[10:00:05] Eu:** ${notes}\n\n`);
      writeFileSync(join(dir, 'notas.md'), `## Resumo\n\n${notes}\n`);
    };
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('Z', '-00:00').slice(0, 19) + '-03:00';
    mk('2026-10-08 1000 - Kickoff Acme', 'Kickoff Acme', day(5), 'Fechamos o orçamento de 50 mil e o prazo é dezembro.');
    mk('2026-10-09 1000 - Retro do time', 'Retro do time', day(2), 'O time está cansado; vamos reduzir as reuniões e revisar a carga.');
  },
});
const result = {};
const ask = async (question) => {
  await app.eval(`(() => { const q = document.getElementById('question'); q.value = ${JSON.stringify(question)}; q.dispatchEvent(new Event('input')); document.getElementById('ask').requestSubmit(); return 0; })()`);
  for (let i = 0; i < 90; i++) {
    await app.sleep(1000);
    const busy = await app.eval(`document.getElementById('ai-via').disabled`);
    if (!busy && i > 2) break;
  }
  return app.eval(`[...document.querySelectorAll('#messages-global .msg.rice')].at(-1)?.textContent`);
};
try {
  await app.sleep(2000);
  await app.eval(`document.getElementById('chat-toggle').click(); 0`);
  await app.sleep(500);
  await app.eval(`setScope({ kind: 'all' }, true); 0`);
  await app.sleep(1000);
  result.ultima = await ask('A última reunião foi sobre o quê?');
  await app.shot(join(out, 'real-ultima-reuniao-pt.png'));
  result.semMatch = await ask('O que falamos sobre kubernetes?');
  await app.shot(join(out, 'real-termo-sem-match-pt.png'));
  result.ontem = await ask('o que fizemos ontem?');
  writeFileSync(join(out, 'real-respostas.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally {
  await app.close();
}
