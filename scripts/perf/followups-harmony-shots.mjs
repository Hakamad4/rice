#!/usr/bin/env node
// Prints da página Pendências (textos longos, todos os grupos, Lembretes ativo) em pt/en, claro/escuro, 420 e 1100.
// Instância isolada e invisível; os fatos são semeados direto em <raiz>/.rice/memory.jsonl. Uso: node scripts/perf/followups-harmony-shots.mjs <saida-dir> [pt-BR|en]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './cdp-app.mjs';

const out = resolve(process.argv[2] ?? '.superpowers/memory/pendencias-harmonia');
const lang = process.argv[3] ?? 'pt-BR';
const en = lang === 'en';
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(10, 0, 0, 0); return d; };
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (offset) => `${isoDate(day(offset))}T10:00:00-03:00`;
const src = (n, title) => ({ dir: `/tmp/fake/${n}`, title, date: stamp(-n) });
const F = en
  ? [
      ['commitment', true, 'Send Acme the revised proposal with the pilot scope, the 10% discount and the three payment options discussed on the call', -2, src(3, 'Acme alignment')],
      ['request', true, 'Review the security questionnaire', 0, src(5, 'Security review')],
      ['commitment', true, 'Book the follow-up call with the Acme finance team to close the contract terms and the billing calendar for the next quarter', 3, src(8, 'Acme kickoff')],
      ['commitment', true, 'Share the pilot results', 12, src(8, 'Acme kickoff')],
      ['request', true, 'Update the onboarding checklist', null, src(12, 'Onboarding sync')],
      ['commitment', false, 'Carlos will send the signed NDA and the updated vendor registration form before the end of the week', 2, src(3, 'Acme alignment')],
      ['request', false, 'Ana asked for a list of integrations', null, src(5, 'Security review')],
    ]
  : [
      ['commitment', true, 'Enviar à Acme a proposta revisada com o escopo do piloto, o desconto de 10% e as três opções de pagamento discutidas na call', -2, src(3, 'Alinhamento Acme')],
      ['request', true, 'Revisar o questionário de segurança', 0, src(5, 'Revisão de segurança')],
      ['commitment', true, 'Marcar a call de acompanhamento com o financeiro da Acme para fechar os termos do contrato e o calendário de cobrança do próximo trimestre', 3, src(8, 'Kickoff Acme')],
      ['commitment', true, 'Compartilhar os resultados do piloto', 12, src(8, 'Kickoff Acme')],
      ['request', true, 'Atualizar o checklist de onboarding', null, src(12, 'Alinhamento de onboarding')],
      ['commitment', false, 'O Carlos vai enviar o NDA assinado e o formulário de cadastro de fornecedor atualizado antes do fim da semana', 2, src(3, 'Alinhamento Acme')],
      ['request', false, 'A Ana pediu a lista de integrações', null, src(5, 'Revisão de segurança')],
    ];
function seed(root) {
  for (let i = 0; i < 10; i++) {
    const d = day(-i - 1);
    const title = i === 2 ? (en ? 'Acme alignment' : 'Alinhamento Acme') : `${en ? 'Meeting' : 'Reunião'} ${en ? 'sync' : 'semanal'} ${i + 1}`;
    const dir = join(root, `${isoDate(d)} 1000 - ${title}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: `m-${i}`, title, startedAt: stamp(-i - 1), endedAt: stamp(-i - 1), state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [] }));
    writeFileSync(join(dir, 'transcricao.md'), '# T\n');
  }
  mkdirSync(join(root, '.rice'), { recursive: true });
  const rows = F.map(([kind, mine, text, due, source], i) => ({ id: `f${i}`, kind, who: mine ? 'Eu' : 'Carlos Lima', org: 'acme', about: `a${i}`, text, ...(due == null ? {} : { due: isoDate(day(due)) }), confidence: 0.9, source, status: 'open', updatedAt: stamp(-1), mine }));
  rows.push({ id: 'fd', kind: 'commitment', who: 'Eu', org: 'acme', about: 'x', text: en ? 'Send the meeting notes' : 'Enviar as notas da reunião', confidence: 0.9, source: src(8, en ? 'Acme kickoff' : 'Kickoff Acme'), status: 'done', updatedAt: stamp(-1), mine: true, doneAt: stamp(-1), doneBy: { dir: '/tmp/fake/3', title: en ? 'Acme alignment' : 'Alinhamento Acme', date: stamp(-3) } });
  writeFileSync(join(root, '.rice', 'memory.jsonl'), rows.map((r) => JSON.stringify({ op: 'put', fact: r })).join('\n') + '\n');
}
const app = await launch({ settings: { uiLanguage: lang, transcriptionLanguage: en ? 'en' : 'pt', keepAudio: false }, size: [1100, 760], seed });
const shots = [];
try {
  await sleep(1500);
  await app.eval(`document.getElementById('followups-link').click(); 0`);
  await sleep(900);
  // Lembretes ativo (a permissão do macOS não existe na instância de teste): repete a página com o status simulado
  await app.eval(`(async () => {
    const holder = document.querySelector('.fu-page').parentElement;
    const rice = Object.assign({}, window.rice, { followupsRemindersStatus: async () => ({ active: true }), followupsToReminders: async () => ({ ok: true, count: 3 }) });
    const page = window.RiceFollowups.create({ rice, onOpen: () => {}, warn: () => {} });
    await page.render(holder);
    return 0;
  })()`);
  await sleep(700);
  for (const scheme of ['light', 'dark']) {
    await app.theme(scheme);
    for (const width of [1100, 420]) {
      await app.setSize(width, 900);
      if (width < 500) await app.eval(`document.body.classList.remove('chat-open'); 0`);
      await sleep(700);
      const name = `pendencias-${lang}-${scheme}-${width}.png`;
      await app.shot(join(out, name));
      shots.push(name);
    }
  }
  // seletor de reunião (com busca) e popover do prazo, quando existem (o código antigo usa os nativos)
  const hasPicker = await app.eval(`!!document.querySelector('.fu-add-meeting .menu-select-btn')`);
  if (hasPicker) {
    for (const scheme of ['light', 'dark']) {
      await app.theme(scheme);
      for (const width of [1100, 420]) {
        await app.setSize(width, 900);
        if (width < 500) await app.eval(`document.body.classList.remove('chat-open'); 0`);
        await app.eval(`document.querySelector('.fu-add-meeting .menu-select-btn').click(); 0`);
        await sleep(400);
        let name = `seletor-${lang}-${scheme}-${width}.png`;
        await app.shot(join(out, name));
        shots.push(name);
        await app.eval(`document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 0`);
        await sleep(200);
        await app.eval(`document.querySelectorAll('.fu-due:not(.none)')[1].click(); 0`);
        await sleep(400);
        name = `prazo-${lang}-${scheme}-${width}.png`;
        await app.shot(join(out, name));
        shots.push(name);
        await app.eval(`document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); 0`);
        await sleep(200);
      }
    }
  }
} finally {
  await app.close();
  console.log(JSON.stringify({ lang, shots: shots.length }));
}
