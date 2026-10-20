// Prints da tradução ao vivo numa instância ISOLADA e invisível: grava com o helper de áudio e o whisper falsos (frases fictícias em pt),
// a "IA" é um Ollama falso em localhost que devolve a tradução combinada (nenhuma rede, nenhum dado real).
// Uso: node scripts/perf/translate-shots.mjs <pasta-de-saída>   -> claro/escuro × normal / janela pequena / zoom 1,44
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '/tmp/rice-translate-shots');
mkdirSync(out, { recursive: true });
const PAIRS = [
  ['Bom dia, pessoal, vamos começar pelo piloto com a Acme.', 'Good morning, everyone, let us start with the pilot with Acme.'],
  ['O primeiro ponto é o cronograma das próximas semanas.', 'The first point is the schedule for the next few weeks.'],
  ['A Ana consolida o roteiro de testes até sexta-feira.', 'Ana consolidates the test script by Friday.'],
  ['Depois voltamos ao orçamento, que está acima do previsto.', 'Then we go back to the budget, which is above forecast.'],
];
const PORT = 11500 + Math.floor(Math.random() * 300);
const ai = createServer((req, res) => {
  if (req.url === '/api/tags') return res.setHeader('content-type', 'application/json').end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 5200000000 }] }));
  if (req.url === '/api/chat') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const prompt = JSON.stringify(JSON.parse(body).messages);
      const last = prompt.split('utterance:').pop() ?? ''; // só a fala atual; o contexto traz as anteriores
      const hit = PAIRS.find(([pt]) => last.includes(pt));
      setTimeout(() => res.end(`${JSON.stringify({ message: { content: hit ? hit[1] : 'OK' }, done: false })}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`), 700);
    });
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((ok) => ai.listen(PORT, '127.0.0.1', ok));

const wav = '/tmp/rice-translate-tone.wav';
try {
  execFileSync('say', ['-v', 'Luciana', '-o', `${wav}.aiff`, PAIRS.map((p) => p[0]).join(' ')], { stdio: 'ignore' });
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', `${wav}.aiff`, wav], { stdio: 'ignore' });
} catch { /* sem say: o helper usa o tom padrão */ }

const app = await launch({
  settings: { uiLanguage: process.env.SHOT_LANG || 'pt-BR', transcriptionLanguage: 'pt', ai: { provider: 'local-model', models: { 'local-model': 'qwen3:8b' }, verified: { 'local-model': true }, light: 'same', local: { url: `http://127.0.0.1:${PORT}` } } },
  env: { RICE_PERF_WAV: wav, RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'), FAKE_WHISPER_LINES: JSON.stringify(PAIRS.map((p) => p[0])) },
});
try {
  const started = await app.eval(`window.rice.startRecording({ title: 'Alinhamento com Acme' })`);
  if (!started || !started.dir) throw new Error('a gravação de teste não começou');
  await app.eval(`openMeeting(${JSON.stringify(started.dir)}); 0`);
  await app.sleep(1500);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  await app.eval(`document.querySelector('.tr-btn').click(); 0`);
  await app.sleep(Number(process.env.SHOT_WAIT || 40000));
  const stats = await app.eval(`JSON.stringify({ rows: document.querySelectorAll('.t-row.has-tr').length, orig: document.querySelectorAll('.t-row.tr-orig').length, btn: document.querySelector('.tr-btn')?.textContent })`);
  console.log('estado da tela:', stats);
  const sizes = { normal: [1180, 760], small: [420, 760], zoom144: [820, 528] }; // zoom 1,44 numa janela de ~1180 px = ~820 px CSS
  for (const theme of ['light', 'dark']) {
    await app.theme(theme);
    for (const [name, [w, h]] of Object.entries(sizes)) {
      await app.setSize(w, h);
      await app.eval(`document.body.classList.contains('chat-open') && document.getElementById('chat-close').click(); 0`); // o painel "Pergunte ao Rice" cobriria a janela pequena
      await app.sleep(900);
      await app.eval(`document.body.classList.contains('chat-open') && document.getElementById('chat-close').click(); 0`);
      await app.sleep(900);
      await app.shot(join(out, `traducao-${theme}-${name}.png`));
    }
  }
  // menu da tradução (com a chave OFFLINE_TRANSLATION ligada no build de teste: botão "Baixar para usar offline" em cada idioma)
  const openMenu = `[...document.querySelectorAll('.tr-menu-btn')].find((b) => b.offsetParent)?.click(); 0`;
  for (const theme of ['light', 'dark']) {
    await app.theme(theme);
    for (const [name, [w, h]] of Object.entries(sizes).filter(([n]) => n !== 'zoom144')) {
      await app.setSize(w, h);
      await app.eval(`window.RiceActionMenu.close(); document.body.classList.contains('chat-open') && document.getElementById('chat-close').click(); 0`);
      await app.sleep(700);
      await app.eval(openMenu);
      await app.sleep(500);
      await app.shot(join(out, `traducao-menu-${theme}-${name}.png`));
      // comparação: o menu de idioma do app e a 1ª versão do menu da tradução (só os idiomas)
      await app.eval(`window.RiceActionMenu.close(); document.getElementById('lang-chip').click(); 0`);
      await app.sleep(400);
      await app.eval(`document.querySelector('.action-menu .action-item')?.dispatchEvent(new MouseEvent('mouseenter')); 0`);
      await app.sleep(300);
      await app.shot(join(out, `ref-idioma-${theme}-${name}.png`));
      await app.eval(`window.RiceActionMenu.close(); window.RiceActionMenu.open({ anchor: [...document.querySelectorAll('.tr-menu-btn')].find((b) => b.offsetParent), items: [{ heading: 'Traduzir para' }, ...['English', 'Español', 'Français', 'Deutsch', 'Italiano'].map((label, i) => ({ label, checked: i === 0, onSelect() {} }))] }); 0`);
      await app.sleep(400);
      await app.shot(join(out, `ref-v1-${theme}-${name}.png`));
    }
  }
} finally {
  await app.close();
  ai.close();
  rmSync(`${wav}.aiff`, { force: true });
}
