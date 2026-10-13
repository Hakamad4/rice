#!/usr/bin/env node
// Capturas de tela de ponta a ponta numa instância ISOLADA e invisível (mock keychain, dados fictícios):
// quadros prontos no lugar da tela (RICE_SHOT_SOURCE_DIR), IA falsa local no lugar da internet (RICE_TEST_AI_BASE_URL),
// whisper falso e áudio de um WAV. Liga a opção pela interface, grava, confere os arquivos, gera as notas e tira os prints.
// Uso: node scripts/perf/screenshots-e2e.mjs <saida-dir> [pt-BR|en]      (precisa de RICE_PERF_WAV: wav 16 kHz mono s16le)
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const repo = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] ?? '.superpowers/shots');
const lang = process.argv[3] ?? 'pt-BR';
mkdirSync(out, { recursive: true });
const wav = process.env.RICE_PERF_WAV;
if (!wav) throw new Error('defina RICE_PERF_WAV');
const tmp = mkdtempSync(join(tmpdir(), 'rice-shots-e2e-'));
const frames = join(tmp, 'frames');
execFileSync('python3', [join(repo, 'scripts/perf/screenshots-frames.py'), frames]);
for (const f of ['2-metas-igual.png', '3-rostos.png']) rmSync(join(frames, f)); // aqui cada captura vem de um momento diferente da fala
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- IA falsa (formato Messages da Anthropic, SSE) ----
// Pedido SEM imagem com <candidatos> = decisão pela fala (só texto); COM imagem = refino da legenda; sem imagem e sem candidatos = notas.
const log = { decisions: [], imageRequests: 0, notesRequests: 0, hosts: new Set(), notesPrompt: '' };
const sse = (text) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
const ai = createServer((req, res) => {
  const parts = [];
  req.on('data', (d) => parts.push(d));
  req.on('end', () => {
    log.hosts.add(req.headers.host);
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    const content = body.messages?.[0]?.content;
    const hasImage = Array.isArray(content) && content.some((c) => c.type === 'image');
    const prompt = typeof content === 'string' ? content : '';
    let text;
    if (hasImage) {
      log.imageRequests++;
      text = JSON.stringify({ useful: true, caption: ['Gráfico de barras com as metas de receita por frente', 'Planilha de custos por frente, com orçado e realizado'][(log.imageRequests - 1) % 2] });
    } else if (/<candidatos>/.test(prompt)) {
      const cands = /<candidatos>\n([\s\S]*?)\n<\/candidatos>/.exec(prompt)?.[1] ?? '';
      const capture = /mostrar|compartilhar/i.test(cands);
      log.decisions.push({ cands, capture });
      text = JSON.stringify({ capture, reason: capture ? (/planilha/i.test(cands) ? 'Carlos mostrou a planilha de custos' : 'Ana compartilhou a tela com as metas do trimestre') : '' });
    } else {
      log.notesRequests++;
      if (/<capturas>/.test(prompt)) {
        log.notesPrompt = prompt;
        const ids = [...prompt.matchAll(/^\[(\d{6}(?:-\d{1,2})?)\]/gm)].map((m) => m[1]);
        text = `## Resumo\n\nO time revisou as metas do trimestre: o piloto com a Acme lidera a receita recorrente.\n${ids[0] ? `<!--shot:${ids[0]}-->\n` : ''}\n## Decisões\n\n- A frente de pesquisa está abaixo do orçado e segue como está até a próxima revisão.\n${ids[1] ? `<!--shot:${ids[1]}-->\n` : ''}\n## Próximas ações\n\n- Ana revisa os custos de onboarding.\n- Carlos fecha o piloto com a Acme.\n<!--shot:999999-->\n`;
      } else text = '## Resumo\n\nSem capturas.\n';
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(sse(text));
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const aiPort = ai.address().port;

const app = await launch({
  settings: { uiLanguage: lang, transcriptionLanguage: 'pt', keepAudio: false, ai: { provider: 'claude-api', models: {}, verified: { 'claude-api': true } } },
  size: [1180, 760],
  env: {
    RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'),
    RICE_PERF_WAV: wav,
    RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'),
    RICE_SHOT_SOURCE_DIR: frames,
    FAKE_WHISPER_LINES: JSON.stringify(['Bom dia pessoal, vamos começar.', 'Primeiro, o status do trimestre.', 'Vou compartilhar minha tela para mostrar as metas.', 'Como vocês podem ver a receita cresceu.', 'Agora vamos falar do orçamento.', 'Deixa eu mostrar a planilha de custos.', 'A pesquisa está abaixo do orçado.', 'Combinado, fechamos por hoje.', 'Obrigado a todos.', 'Até a próxima.', 'Tchau.', 'Tchau.', 'Tchau.', 'Tchau.', 'Tchau.', 'Tchau.']),
    RICE_TEST_AI_BASE_URL: `http://127.0.0.1:${aiPort}`,
  },
});
const report = { lang };
const click = (sel) => app.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).click?.(); 0`);
const text = (sel) => app.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
try {
  await app.eval(`window.rice.saveAiKey('claude-api', 'sk-ant-api03-fake-test-key-0000000000')`);
  // 1) Configurações → Capturas de tela → ligar → aviso
  await app.eval(`document.getElementById('settings-link').click(); 0`);
  await sleep(1200);
  await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => b.querySelector('span').textContent === ${JSON.stringify(lang === 'en' ? 'Screenshots' : 'Capturas de tela')}).click(); 0`);
  await sleep(500);
  report.defaultOff = await app.eval(`document.getElementById('screenshots').checked === false`);
  await click('#screenshots');
  await sleep(600);
  report.dialogText = await text('.dialog');
  await app.shot(join(out, `capturas-dialogo-ativacao${lang === 'en' ? '-en' : ''}.png`));
  await app.eval(`[...document.querySelectorAll('.dialog .dlg-foot button')].pop().click(); 0`);
  await sleep(800);
  report.afterEnable = await app.eval(`({ checked: document.getElementById('screenshots').checked, settings: window.rice.getSettings().then((s) => s.screenshots) })`);
  report.settingsFlag = await app.eval(`window.rice.getSettings().then((s) => s.screenshots)`);
  await app.shot(join(out, `capturas-configuracoes${lang === 'en' ? '-en' : ''}.png`));

  // 2) gravar com a opção ligada
  await app.eval(`document.getElementById('home-link').click(); 0`);
  await sleep(500);
  const started = await app.eval(`window.rice.startRecording({ title: ${JSON.stringify(lang === 'en' ? 'Quarter planning' : 'Planejamento do trimestre')} })`);
  report.started = started.ok;
  const dir = started.dir;
  await app.eval(`openMeeting(${JSON.stringify(dir)}); 0`);
  await sleep(46000);
  report.status = await text('#status');
  report.transcript = await app.eval(`window.rice.readMeeting(${JSON.stringify(dir)}).then((m) => m.transcript)`);
  report.chip = await app.eval(`(() => { const c = document.getElementById('shots-chip'); return { hidden: c.hidden, text: c.textContent }; })()`);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  await sleep(500);
  await app.shot(join(out, `capturas-gravando${lang === 'en' ? '-en' : ''}.png`));
  // desligar no meio da gravação pelo controle da reunião
  await click('#shots-chip');
  await sleep(300);
  report.chipMenu = await app.eval(`[...document.querySelectorAll('.menu-item')].map((b) => b.textContent)`);
  await app.eval(`[...document.querySelectorAll('.menu-item')].find((b) => /Desligar|Turn off/.test(b.textContent)).click(); 0`);
  await sleep(800);
  report.afterOff = await app.eval(`({ flag: window.rice.getSettings().then((s) => s.screenshots), hidden: document.getElementById('shots-chip').hidden })`);
  const countAtOff = (await app.eval(`window.rice.screenshotsList(${JSON.stringify(dir)}).then((r) => r.shots.length)`));
  await sleep(7000);
  report.stoppedAfterOff = (await app.eval(`window.rice.screenshotsList(${JSON.stringify(dir)}).then((r) => r.shots.length)`)) === countAtOff;
  const stopped = await app.eval(`window.rice.stopRecording()`);
  report.stopped = stopped.ok;
  // 3) notas geradas ao parar (IA falsa cita as capturas)
  for (let i = 0; i < 60; i++) {
    const notes = await app.eval(`window.rice.readMeeting(${JSON.stringify(dir)}).then((m) => m.notes)`);
    if (notes && notes.length > 20) break;
    await sleep(1000);
  }
  await app.eval(`openMeeting(${JSON.stringify(dir)}); 0`);
  await sleep(1500);
  await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
  await sleep(600);
  await app.shot(join(out, `capturas-transcricao${lang === 'en' ? '-en' : ''}.png`));
  await app.eval(`document.querySelectorAll('.mt-tab')[0].click(); 0`);
  await sleep(600);
  report.notesShots = await app.eval(`document.querySelectorAll('.mt-body .note-shot').length`);
  report.notesHtml = await app.eval(`document.querySelector('.mt-body .md').textContent.includes('shot')`);
  await app.shot(join(out, `capturas-notas${lang === 'en' ? '-en' : ''}.png`));

  // 4) o que ficou no disco
  const shots = JSON.parse(readFileSync(join(dir, 'capturas.json'), 'utf8'));
  report.index = shots;
  report.files = readdirSync(join(dir, 'capturas'));
  report.sizesKB = report.files.map((f) => Math.round(readFileSync(join(dir, 'capturas', f)).length / 1024));
  report.dims = report.files.map((f) => execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(dir, 'capturas', f)]).toString().replace(/\n/g, ' ').replace(/.*pixelWidth: (\d+).*pixelHeight: (\d+).*/, '$1x$2'));
  report.aiDecisions = log.decisions;
  report.aiImageRequests = log.imageRequests;
  report.aiNotesRequests = log.notesRequests;
  report.aiHosts = [...log.hosts];
  report.notesPromptHasCaptions = /<capturas>/.test(log.notesPrompt);
  report.finalNotes = readFileSync(join(dir, 'notas.md'), 'utf8');
} finally {
  await app.close();
  ai.close();
  writeFileSync(join(out, `capturas-e2e${lang === 'en' ? '-en' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}
