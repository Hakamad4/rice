#!/usr/bin/env node
// Memória entre reuniões e Pendências de ponta a ponta numa instância ISOLADA e invisível (mock keychain, dados fictícios):
// 3 reuniões fictícias com a Acme (pedido de desconto + promessa da proposta; alinhamento; "mandei a proposta"), IA falsa local,
// montagem da memória pelo botão (backfill), pendência vencida e depois fechada, "O que lembrar" de um evento novo, notificação.
// Uso: node scripts/perf/memory-e2e.mjs <saida-dir> [pt-BR|en]
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/memory');
const lang = process.argv[3] ?? 'pt-BR';
const en = lang === 'en';
const ramOnly = process.argv.includes('--ram-only'); // linha de base: memória desligada, só mede a RAM
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'rice-mem-'));
const notifyLog = join(tmp, 'notify.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const day = (offset, h = 10) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 0, 0, 0); return d; };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localIso = (d) => `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00-03:00`;
/** Próximo dia da semana (0=dom) depois de `from`. */
const nextWeekday = (from, wd) => { const d = new Date(from); d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7 || 7)); return d; };

const T = en ? {
  m1: 'Acme kickoff', m2: 'Acme alignment', m3: 'Proposal follow-up', event: 'Acme proposal review',
  n1: '## Summary\n\nAna (Acme) asked for a 10% discount on the annual plan. Carlos will send the proposal until Friday. I will send the contract until Wednesday.\n\n## Next steps\n\n- [ ] Send the proposal to Acme — Carlos\n- [ ] Send the contract — Me\n',
  n2: '## Summary\n\nThe team agreed to start with the pilot. The proposal is still being prepared.\n',
  n3: '## Summary\n\nCarlos: "I sent the proposal this morning." Ana confirmed she received it.\n',
  f1: 'Ana asked for a 10% discount on the annual plan', f2: 'Carlos sends the proposal until Friday', f3: 'I send the contract until Wednesday', f4: 'They decided to start with the pilot',
  about: ['discount', 'proposal', 'contract', 'pilot'],
} : {
  m1: 'Kickoff Acme', m2: 'Alinhamento Acme', m3: 'Retorno da proposta', event: 'Revisão da proposta Acme',
  n1: '## Resumo\n\nA Ana (Acme) pediu 10% de desconto no plano anual. O Carlos manda a proposta até sexta. Eu envio o contrato até quarta.\n\n## Próximas ações\n\n- [ ] Enviar a proposta para a Acme — Carlos\n- [ ] Enviar o contrato — Eu\n',
  n2: '## Resumo\n\nO time combinou começar pelo piloto. A proposta ainda está sendo preparada.\n',
  n3: '## Resumo\n\nCarlos: "mandei a proposta hoje de manhã". Ana confirmou que recebeu.\n',
  f1: 'Ana pediu 10% de desconto no plano anual', f2: 'Carlos manda a proposta até sexta', f3: 'Eu envio o contrato até quarta', f4: 'Decidiram começar pelo piloto',
  about: ['desconto', 'proposta', 'contrato', 'piloto'],
};
const people = { participants: ['Ana Silva', 'Carlos Lima'], participantEmails: ['ana.silva@acme.com', 'carlos.lima@acme.com'] };
const dates = { m1: day(-12), m2: day(-8), m3: day(-3) };
const friday = isoDate(nextWeekday(dates.m1, 5));
const wednesday = isoDate(nextWeekday(dates.m1, 3));

function seedMeeting(root, key, title, notes) {
  const d = dates[key];
  const dir = join(root, `${isoDate(d)} 1000 - ${title}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: `id-${key}`, title, startedAt: localIso(d), endedAt: localIso(new Date(d.getTime() + 3600_000)), state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [], ...people }));
  writeFileSync(join(dir, 'transcricao.md'), `# T\n\n**[10:00:05] Eu:** ${title}\n\n`);
  writeFileSync(join(dir, 'notas.md'), notes);
  return dir;
}

// ---- IA falsa (Anthropic Messages, SSE) ----
const log = { extract: [], brief: [], other: 0 };
const sse = (text) => `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
const ai = createServer((req, res) => {
  const parts = [];
  req.on('data', (d) => parts.push(d));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(parts).toString() || '{}');
    const prompt = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : '';
    const system = String(body.system ?? '');
    let text = '{}';
    if (/extract durable facts/.test(system)) {
      const title = /Meeting: (.*)/.exec(prompt)?.[1] ?? '';
      const open = [...prompt.matchAll(/^\[([\w-]+)\] ([^:]+): (.*)$/gm)].map((m) => ({ id: m[1], text: m[3] }));
      let answer = { facts: [], resolves: [] };
      if (title === T.m1) answer = { facts: [
        { kind: 'request', who: 'Ana Silva', about: T.about[0], text: T.f1, due: null, confidence: 0.9 },
        { kind: 'commitment', who: 'Carlos Lima', about: T.about[1], text: T.f2, due: friday, confidence: 0.9 },
        { kind: 'commitment', who: 'Eu', about: T.about[2], text: T.f3, due: wednesday, confidence: 0.85 },
      ], resolves: [] };
      else if (title === T.m2) answer = { facts: [{ kind: 'decision', who: 'Ana Silva', about: T.about[3], text: T.f4, due: null, confidence: 0.8 }], resolves: [] };
      else if (title === T.m3) answer = { facts: [], resolves: open.filter((o) => /proposta|proposal/i.test(o.text)).map((o) => o.id) };
      log.extract.push({ title, promptChars: prompt.length + system.length, outputChars: JSON.stringify(answer).length });
      text = JSON.stringify(answer);
    } else if (/You prepare a person/.test(system)) {
      const lines = [...prompt.matchAll(/^\[([\w-]+)\] (\w+)( \(done\))? · ([^:]*): (.*)$/gm)];
      const pick = lines.filter((m) => m[2] === 'request' || m[2] === 'commitment').slice(0, 4);
      const bullets = pick.map((m) => ({ fact: m[1], text: m[5] }));
      log.brief.push({ promptChars: prompt.length + system.length, outputChars: JSON.stringify({ bullets }).length });
      text = JSON.stringify({ bullets });
    } else log.other++;
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(sse(text));
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const aiPort = ai.address().port;

const soon = new Date(Date.now() + 10 * 60_000);
const testEvent = { id: 'ev-acme', title: T.event, start: soon.toISOString(), end: new Date(soon.getTime() + 3600_000).toISOString(), calendar: 'Trabalho', attendees: 3, attendeeNames: ['Ana Silva'], attendeeEmails: ['ana.silva@acme.com'], joinUrl: 'https://meet.google.com/aaa-bbbb-ccc', source: 'google' };

const app = await launch({
  settings: { ...(ramOnly ? { memory: false } : {}), uiLanguage: lang, transcriptionLanguage: en ? 'en' : 'pt', keepAudio: false, ai: { provider: 'claude-api', models: {}, verified: { 'claude-api': true } } },
  size: [1100, 760],
  seed: (root) => { seedMeeting(root, 'm1', T.m1, T.n1); seedMeeting(root, 'm2', T.m2, T.n2); },
  env: { RICE_TEST_AI_BASE_URL: `http://127.0.0.1:${aiPort}`, RICE_TEST_EVENTS: JSON.stringify([testEvent]), RICE_NOTIFY_LOG: notifyLog },
});
const report = { lang };
const click = (sel) => app.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).click?.(); 0`);
const text = (sel) => app.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
const clickText = (sel, re) => app.eval(`([...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => ${re}.test(b.textContent)) || {}).click?.(); 0`);
const pidsOfApp = () => execFileSync('bash', ['-c', "ps -axo pid=,rss=,command= | grep -i 'rice-shot' | grep -v grep | awk '{s+=$2} END {print int(s/1024)}'"]).toString().trim();
const shots = [];
const overflows = {};
async function matrix(view, setup) {
  for (const scheme of ['light', 'dark']) {
    await app.theme(scheme);
    for (const width of [1100, 420]) {
      await app.setSize(width, 760);
      if (width < 500) await app.eval(`document.body.classList.remove('chat-open'); 0`);
      await setup();
      await sleep(900);
      overflows[`${view}-${scheme}-${width}`] = await app.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1 && !document.querySelector('#detail') || (() => { const d = document.getElementById('detail'); return d.scrollWidth <= d.clientWidth + 1; })()`);
      const name = `memoria-${view}-${lang}-${scheme}-${width}.png`;
      await app.shot(join(out, name));
      shots.push(name);
    }
  }
}
const overflow = (name) => app.eval(`({ ${name}: document.documentElement.scrollWidth <= window.innerWidth + 1 })`);
try {
  await app.eval(`window.rice.saveAiKey('claude-api', 'sk-ant-api03-fake-test-key-0000000000')`);
  await sleep(1500);
  report.ramBeforeMB = Number(pidsOfApp());
  if (ramOnly) {
    await app.eval(`document.getElementById('followups-link').click(); 0`);
    await sleep(20000); // mesmo tempo do fluxo completo (o aviso de vencimento também roda)
    report.ramAfterMB = Number(pidsOfApp());
    report.memoryOff = true;
    throw new Error('ram-only');
  }

  // 1) Configurações › Memória: reuniões antigas (confirmação, progresso) — nada roda sem o clique
  await app.eval(`document.getElementById('settings-link').click(); 0`);
  await sleep(1200);
  await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => b.querySelector('span').textContent === ${JSON.stringify(en ? 'Memory' : 'Memória')}).click(); 0`);
  await sleep(1000);
  report.beforeClick = { aiCalls: log.extract.length, backfillText: await text('.mem-backfill'), stats: await text('.mem-stats') };
  await clickText('.mem-backfill button', en ? '/Build memory/' : '/Montar memória/');
  await sleep(600);
  report.confirmText = await text('.dialog');
  await app.shot(join(out, `memoria-confirmar-backfill-${lang}.png`));
  await app.eval(`[...document.querySelectorAll('.dialog button')].filter((b) => !/${en ? 'Cancel' : 'Cancelar'}/.test(b.textContent)).pop().click(); 0`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await app.eval(`window.rice.memoryStatus()`);
    if (s.backfill.state === 'finished') break;
  }
  report.afterBackfill1 = await app.eval(`window.rice.memoryStatus()`);

  // 2) Pendências: a promessa do Carlos venceu (e a minha do contrato)
  await click('#followups-link');
  await sleep(1500);
  await clickText('.fu-chip', en ? '/^All$/' : '/^Todas$/');
  await sleep(1500);
  report.followups1Body = await text('.fu-body');
  report.followups1 = await app.eval(`({ titles: [...document.querySelectorAll('.fu-group-title')].map((h) => h.firstChild.textContent), rows: [...document.querySelectorAll('.fu-row')].map((r) => r.querySelector('.fu-text').textContent), badge: document.getElementById('followups-badge').textContent })`);

  // 3) a reunião 3 chega ("mandei a proposta"): montar de novo fecha a pendência do Carlos, com a fonte
  seedMeeting(app.root, 'm3', T.m3, T.n3);
  await app.eval(`document.getElementById('settings-link').click(); 0`);
  await sleep(1000);
  await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => b.querySelector('span').textContent === ${JSON.stringify(en ? 'Memory' : 'Memória')}).click(); 0`);
  await sleep(1000);
  report.pendingAfterM3 = (await app.eval(`window.rice.memoryStatus()`)).pendingMeetings;
  await clickText('.mem-backfill button', en ? '/Build memory/' : '/Montar memória/');
  await sleep(600);
  await app.eval(`[...document.querySelectorAll('.dialog button')].filter((b) => !/${en ? 'Cancel' : 'Cancelar'}/.test(b.textContent)).pop().click(); 0`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const s = await app.eval(`window.rice.memoryStatus()`);
    if (s.backfill.state === 'finished' && s.pendingMeetings === 0) break;
  }
  await sleep(800);
  report.status = await app.eval(`window.rice.memoryStatus()`);
  const all = await app.eval(`window.rice.followupsList('all')`);
  report.done = all.groups.done.map((f) => ({ text: f.text, doneBy: f.doneBy && f.doneBy.title }));
  report.open = ['overdue', 'today', 'week', 'later', 'nodue'].flatMap((g) => all.groups[g].map((f) => ({ g, text: f.text, mine: f.mine })));

  // 4) páginas e prints (claro/escuro, 1100 e 420)
  await matrix('memoria-pagina', async () => {
    await app.eval(`document.getElementById('settings-link').click(); 0`);
    await sleep(700);
    await app.eval(`[...document.querySelectorAll('.set-nav-item')].find((b) => b.querySelector('span').textContent === ${JSON.stringify(en ? 'Memory' : 'Memória')}).click(); 0`);
    await sleep(600);
    await app.eval(`document.querySelectorAll('.mem-group').forEach((d) => (d.open = true)); 0`);
  });
  report.layoutMemoria = await overflow('memoryPage');
  await matrix('pendencias', async () => {
    await click('#followups-link');
    await sleep(900);
    await clickText('.fu-chip', en ? '/^All$/' : '/^Todas$/');
    await sleep(500);
    await app.eval(`document.querySelector('.fu-done-group') && (document.querySelector('.fu-done-group').open = true); 0`);
  });
  report.layoutPendencias = await overflow('followups');

  // 5) evento novo com alguém da Acme: Início (linha) e nota do evento (cartão)
  await matrix('inicio', async () => {
    await click('#home-link');
    await sleep(1500);
  });
  report.home = await app.eval(`(() => { const l = document.querySelector('.ev-memory'); return l ? { text: l.querySelector('.ev-mem-text').textContent, more: l.querySelector('.ev-mem-more').textContent } : null; })()`);
  await app.setSize(1100, 760);
  await click('#home-link');
  await sleep(1200);
  await app.eval(`(document.querySelector('.ev-mem-more') || {}).click?.(); 0`);
  await sleep(2500);
  report.card = await app.eval(`(() => { const c = document.querySelector('.mem-card'); return c && !c.hidden ? { title: c.querySelector('.mem-title').textContent, bullets: [...c.querySelectorAll('.mem-bullet')].map((b) => ({ text: b.querySelector('.mem-text').textContent, done: b.classList.contains('done'), late: b.classList.contains('late'), kind: b.querySelector('.mem-kind').textContent, source: b.querySelector('.mem-src').textContent })), recent: [...c.querySelectorAll('.mem-recent .mem-src')].map((s) => s.textContent) } : null; })()`);
  await matrix('cartao', async () => {
    await app.eval(`document.querySelectorAll('.mt-tab')[0] && document.querySelectorAll('.mt-tab')[0].click(); 0`);
    await sleep(500);
  });

  // 6) notificação local (instância de teste: registrada em arquivo, nada aparece na tela)
  for (let i = 0; i < 30 && !existsSync(notifyLog); i++) await sleep(1000);
  report.notification = existsSync(notifyLog) ? readFileSync(notifyLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  report.ramAfterMB = Number(pidsOfApp());
  report.aiCalls = { extract: log.extract, brief: log.brief, other: log.other };
  report.shots = shots.length;
  report.noHorizontalScroll = overflows;
} catch (err) {
  if (err.message !== 'ram-only') throw err;
} finally {
  await app.close();
  ai.close();
  writeFileSync(join(out, `memoria-e2e-${lang}${ramOnly ? '-ram' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
}
