// Gera os prints da documentação (docs/images/<idioma>/NN-nome.png) numa instância ISOLADA e invisível do Rice.
// Dados 100% fictícios (pasta em /tmp, nomes genéricos: Ana, Carlos, Acme), janela 1200x760, tema escuro.
// Uso: node scripts/docs-shots.mjs [pt-BR|en]   (sem argumento: os dois idiomas)
// Reproduzível: a mesma pasta de dados fictícios é montada a cada execução. Datas da agenda e dos lembretes são
// relativas a hoje (a agenda mostra "hoje"), então o conteúdo é o mesmo, mas as horas dependem do dia da execução.
// Cada cena que não consegue capturar é reportada no final (não some em silêncio).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from './perf/cdp-app.mjs';

const repo = resolve(import.meta.dirname, '..');
const langs = process.argv[2] ? [process.argv[2]] : ['pt-BR', 'en'];
const W = 1200;
const H = 760;

const T = {
  'pt-BR': { plan: 'Planejamento do trimestre', kick: 'Kickoff da campanha', contract: 'Revisão do contrato Acme', oneone: '1:1 com Ana', weekly: 'Weekly Produto', nego: 'Negociação Acme', folders: ['Produto', 'Roadmap', 'Clientes', 'Acme', 'Pessoas'], home: 'Início' },
  en: { plan: 'Quarter planning', kick: 'Campaign kickoff', contract: 'Acme contract review', oneone: '1:1 with Ana', weekly: 'Weekly Product', nego: 'Acme negotiation', folders: ['Product', 'Roadmap', 'Clients', 'Acme', 'People'], home: 'Home' },
};

const day = (offsetDays, hh, mm) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return d;
};
const iso = (d) => d.toISOString();
/** Horas à frente de agora: a agenda do Início só lista o que ainda não passou. */
const ahead = (hours) => new Date(Date.now() + hours * 3600000);

/** Textos do fixture por idioma: nada de português nos prints em inglês. */
const C = {
  'pt-BR': {
    transcript: ['Vamos fechar o escopo do trimestre e os donos de cada frente.', 'Eu levo o piloto com o cliente Acme até sexta.'],
    unnamed: 'Eu acho que o calendário pode esperar o piloto.',
    notes: '## Resumo\n\nO time definiu as três frentes do próximo trimestre: onboarding, integração com a agenda e pesquisa com usuários.\n\n## Decisões\n\n- Onboarding é a primeira frente.\n- Piloto com cinco clientes antes da integração.\n\n## Próximas ações\n\n- [ ] Conduzir o piloto com cinco clientes — Carlos\n- [ ] Montar o roteiro de testes até sexta — Ana\n',
    annotations: '## Ideias da reunião\n\n- Medir o onboarding por semana\n- [ ] Confirmar o piloto com Acme\n',
    ideas: ['Medir o onboarding por semana, não só no fim do trimestre.', 'Quantos clientes do piloto já aceitaram o calendário?', 'O orçamento da pesquisa ainda não foi definido e trava a segunda frente.'],
    warIdeas: ['Oferecer piloto de 30 dias com preço fixo por assento.', 'Quem do Acme assina o contrato até 30 de novembro?', 'Concorrente X pode fechar o mesmo cliente antes da nossa proposta.'],
    facts: ['O cliente Acme pediu preço por assento até 30 de novembro.', 'Concorrente X anunciou integração com calendário em setembro.', 'O contrato anterior previa reajuste anual de 5%.'],
    factRefs: ['Carlos', 'https://example.com/concorrente-x', 'contrato-2025.txt:14'],
    attachImage: 'Acme · piloto',
    chat: { q: 'Quem fica com cada frente?', a: 'Onboarding: Ana. Integração com a agenda: Carlos. Pesquisa com usuários: ainda sem dono.' },
    globalChat: { q: 'O que o Acme pediu nas últimas reuniões?', a: 'O cliente Acme quer preço por assento até 30 de novembro [1], e o contrato anterior previa reajuste de 5% ao ano [2].' },
    email: { to: ['ana@example.com', 'carlos@example.com'], subject: 'Follow-up: planejamento do trimestre', body: 'Oi, pessoal!\n\nSegue o resumo da reunião de planejamento do trimestre:\n\n- Três frentes: onboarding, integração com a agenda e pesquisa com usuários.\n- Piloto com cinco clientes antes da integração.\n\nPróximos passos: Carlos conduz o piloto e Ana monta o roteiro de testes até sexta.\n\nObrigado!' },
    vocab: ['OKR', 'Acme', 'Horizonte', 'onboarding'],
    permsTitle: 'Permissões do macOS',
    agendaNav: 'Agenda',
    lightLabel: 'Modelo leve para tarefas auxiliares',
    attachFiles: [['proposta-acme.txt', 'Proposta Acme: piloto com cinco clientes.'], ['agenda-kickoff.txt', 'Agenda do kickoff: escopo, donos e prazos.']],
  },
  en: {
    transcript: ['Let us close the quarter scope and the owner of each front.', 'I will take the pilot with the Acme client until Friday.'],
    unnamed: 'I think the calendar can wait until after the pilot.',
    notes: '## Summary\n\nThe team set the three fronts for next quarter: onboarding, calendar integration and user research.\n\n## Decisions\n\n- Onboarding is the first front.\n- Pilot with five clients before the integration.\n\n## Next steps\n\n- [ ] Run the pilot with five clients — Carlos\n- [ ] Write the test script by Friday — Ana\n',
    annotations: '## Meeting ideas\n\n- Measure onboarding every week\n- [ ] Confirm the pilot with Acme\n',
    ideas: ['Measure onboarding every week, not only at the end of the quarter.', 'How many pilot clients already accepted the calendar?', 'The research budget is still undefined and blocks the second front.'],
    warIdeas: ['Offer a 30-day pilot with a fixed price per seat.', 'Who at Acme signs the contract by November 30?', 'Competitor X may close the same client before our proposal.'],
    facts: ['The Acme client asked for a per-seat price until November 30.', 'Competitor X announced calendar integration in September.', 'The previous contract set a 5% yearly increase.'],
    factRefs: ['Carlos', 'https://example.com/competitor-x', 'contract-2025.txt:14'],
    attachImage: 'Acme · pilot',
    chat: { q: 'Who owns each front?', a: 'Onboarding: Ana. Calendar integration: Carlos. User research: no owner yet.' },
    globalChat: { q: 'What did Acme ask for in the latest meetings?', a: 'The Acme client wants a per-seat price until November 30 [1], and the previous contract set a 5% yearly increase [2].' },
    email: { to: ['ana@example.com', 'carlos@example.com'], subject: 'Follow-up: quarter planning', body: 'Hi all,\n\nHere is the summary of the quarter planning meeting:\n\n- Three fronts: onboarding, calendar integration and user research.\n- Pilot with five clients before the integration.\n\nNext steps: Carlos runs the pilot and Ana writes the test script by Friday.\n\nThanks!' },
    vocab: ['OKR', 'Acme', 'Horizon', 'onboarding'],
    permsTitle: 'macOS permissions',
    agendaNav: 'Calendar',
    lightLabel: 'Light model for helper tasks',
    attachFiles: [['acme-proposal.txt', 'Acme proposal: pilot with five clients.'], ['kickoff-agenda.txt', 'Kickoff agenda: scope, owners and deadlines.']],
  },
};

/** Monta a pasta fictícia: pastas (com aninhamento), reuniões com notas, anotações, ideias e a War room. */
function seed(lang) {
  const L = T[lang];
  const K = C[lang];
  return (root) => {
    const folderIds = { produto: 'f-produto', roadmap: 'f-roadmap', clientes: 'f-clientes', acme: 'f-acme', pessoas: 'f-pessoas' };
    const folders = [
      { id: folderIds.produto, name: L.folders[0], createdAt: iso(day(-30, 9, 0)), order: 0 },
      { id: folderIds.roadmap, name: L.folders[1], createdAt: iso(day(-30, 9, 0)), order: 0, parentId: folderIds.produto },
      { id: folderIds.clientes, name: L.folders[2], createdAt: iso(day(-30, 9, 0)), order: 1 },
      { id: folderIds.acme, name: L.folders[3], createdAt: iso(day(-30, 9, 0)), order: 0, parentId: folderIds.clientes },
      { id: folderIds.pessoas, name: L.folders[4], createdAt: iso(day(-30, 9, 0)), order: 2 },
    ];
    mkdirSync(join(root, '.rice'), { recursive: true });
    writeFileSync(join(root, '.rice', 'folders.json'), JSON.stringify({ folders }));

    const meetings = [
      { title: L.plan, at: day(-1, 10, 0), minutes: 25, folder: folderIds.produto, notes: true },
      { title: L.kick, at: day(-2, 10, 0), minutes: 40, folder: folderIds.produto },
      { title: L.weekly, at: day(-3, 11, 0), minutes: 30, folder: folderIds.roadmap },
      { title: L.contract, at: day(-4, 14, 30), minutes: 35, folder: folderIds.acme },
      { title: L.oneone, at: day(-5, 9, 0), minutes: 30, folder: folderIds.pessoas },
      { title: L.nego, at: day(-6, 15, 0), minutes: 45, folder: folderIds.acme, warroom: true },
    ];
    const line = (text, who, at) => `**[${at}] ${who}:** ${text}\n\n`;
    const dirs = {};
    meetings.forEach((m, i) => {
      const dir = join(root, `${m.at.toISOString().slice(0, 10)} ${String(i).padStart(2, '0')} - ${m.title}`);
      dirs[m.title] = dir;
      mkdirSync(dir, { recursive: true });
      const end = new Date(m.at.getTime() + m.minutes * 60000);
      writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: `doc-${i}`, title: m.title, startedAt: iso(m.at), endedAt: iso(end), state: 'done', trigger: 'manual', notesStatus: 'done', gaps: [], folderId: m.folder, speakers: { 1: 'Ana', 2: 'Carlos' }, participantEmails: m.title === L.plan ? K.email.to : undefined }));
      // a reunião do Kickoff tem um falante ainda sem nome (cena do nome de falante)
      const unnamed = m.title === L.kick ? line(K.unnamed, lang === 'en' ? 'Person 1' : 'Pessoa 1', '00:02:10') : '';
      writeFileSync(join(dir, 'transcricao.md'), `# ${m.title}\n\n${line(K.transcript[0], 'Ana', '00:00:05')}${line(K.transcript[1], 'Carlos', '00:01:12')}${unnamed}`);
      if (m.notes || m.warroom) {
        writeFileSync(join(dir, 'ideias.jsonl'), (m.warroom ? K.warIdeas : K.ideas).map((text, j) => JSON.stringify({ id: `i${j + 1}`, at: iso(m.at), kind: ['idea', 'question', 'risk'][j], text })).join('\n') + '\n');
      }
      if (m.notes) {
        writeFileSync(join(dir, 'notas.md'), K.notes);
        writeFileSync(join(dir, 'anotacoes.md'), K.annotations);
        // conversa no painel "Pergunte ao Rice" desta reunião (chat.jsonl, o mesmo formato do app)
        writeFileSync(join(dir, 'chat.jsonl'), JSON.stringify({ at: iso(end), question: K.chat.q, answer: K.chat.a }) + '\n');
      }
      if (m.warroom) {
        writeFileSync(join(dir, 'warroom.json'), JSON.stringify({
          kind: 'warroom', ideas: { on: true, intervalMin: 5 }, investigation: { intervalMin: 5, paused: false },
          sources: { web: true, mcp: false, folder: null }, ideasCycles: 3, investigationCycles: 2, extraCycles: 0,
          facts: [
            { id: 'f1', at: iso(m.at), text: K.facts[0], source: { type: 'audio', ref: K.factRefs[0] }, pinned: true },
            { id: 'f2', at: iso(m.at), text: K.facts[1], source: { type: 'url', ref: K.factRefs[1] } },
            { id: 'f3', at: iso(m.at), text: K.facts[2], source: { type: 'file', ref: K.factRefs[2] } },
          ],
        }));
      }
    });
    // conversa do chat "entre reuniões" (.rice/chat-global.jsonl) com citações [1] e [2] para reuniões reais do fixture
    mkdirSync(join(root, '.rice'), { recursive: true });
    writeFileSync(join(root, '.rice', 'chat-global.jsonl'), JSON.stringify({
      at: iso(day(0, 9, 0)), question: K.globalChat.q, answer: K.globalChat.a, scope: { kind: 'all' }, terms: [],
      citations: [
        { n: 1, dir: dirs[L.nego], title: L.nego, date: iso(day(-6, 15, 0)) },
        { n: 2, dir: dirs[L.contract], title: L.contract, date: iso(day(-4, 14, 30)) },
      ],
    }) + '\n');
  };
}

/** Cena = nome do arquivo + passos. Cada passo usa a instância já aberta (`app`) e devolve nada; o shot é feito no fim. */
const scenes = (lang) => {
  const L = T[lang];
  const K = C[lang];
  const clickText = (sel, text) => `(() => { const n = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!n) throw new Error('não achei ' + ${JSON.stringify(text)}); n.click(); return true; })()`;
  // abre a reunião na aba Notas: o app lembra a última aba de cada reunião, e uma cena não pode herdar a da anterior
  const open = async (app, title) => {
    const ok = await app.eval(`(() => { const n = [...document.querySelectorAll('.meeting')].find((x) => x.textContent.includes(${JSON.stringify(title)})); n?.click(); return !!n; })()`);
    if (!ok) throw new Error(`reunião não achada na barra lateral: ${title}`);
    await app.sleep(500);
    await app.eval(clickText('.mt-tab', lang === 'en' ? 'Notes' : 'Notas'));
    return ok;
  };
  const tab = (app, text) => app.eval(`(() => { const n = [...document.querySelectorAll('.mt-tab')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!n) throw new Error('aba não achada: ' + ${JSON.stringify(text)}); n.click(); return true; })()`);
  /** Clica no item de um menu aberto pelo texto exato (o rótulo fica num elemento sem filhos dentro do menu). */
  const menuItem = (app, label) => app.eval(`(() => { const n = [...document.querySelectorAll('.action-menu *')].filter((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(label)}).pop(); if (!n) throw new Error('item de menu não achado: ' + ${JSON.stringify(label)}); n.click(); return true; })()`);
  /** Garante o painel "Pergunte ao Rice" aberto ou fechado (ele já vem aberto em reuniões). */
  const chat = (app, wantOpen) => app.eval(`(() => { const open = document.body.classList.contains('chat-open'); if (open !== ${wantOpen}) document.getElementById('chat-toggle').click(); return true; })()`);
  /** Início depois do carregamento da agenda: o detector responde alguns segundos após abrir o app, então o Início é aberto de novo. */
  const homeReloaded = async (app) => { await app.eval(`document.getElementById('home-link').click()`); await app.sleep(2500); await app.eval(`document.getElementById('home-link').click()`); await app.sleep(1000); };
  const moreMenu = (app) => app.eval(`(() => { const b = document.querySelector('.more-btn'); if (!b) throw new Error('botão ⋯ não achado'); b.click(); return true; })()`);
  return [
    ['01-meeting', async (app) => { await open(app, L.plan); await app.sleep(1200); }],
    ['02-chat', async (app) => { await open(app, L.plan); await app.sleep(800); await chat(app, true); await app.sleep(800); }],
    ['03-transcript', async (app) => { await open(app, L.plan); await app.sleep(800); await tab(app, lang === 'en' ? 'Transcript' : 'Transcrição'); await app.sleep(600); }],
    ['04-template-picker', async (app) => {
      await open(app, L.plan);
      await app.sleep(1500);
      // o seletor pode ainda estar carregando os templates: tenta de novo até o popover abrir
      for (let i = 0; i < 3; i++) {
        await app.eval(`(() => { const b = document.querySelector('.tpl-chip'); if (!b) throw new Error('seletor de template não achado'); if (!document.querySelector('.tpl-popover')) b.click(); return true; })()`);
        await app.sleep(600);
        if (await app.eval(`!!document.querySelector('.tpl-popover')`)) return;
      }
      throw new Error('o seletor não abriu o popover: ' + (await app.eval(`JSON.stringify({ chips: [...document.querySelectorAll('.tpl-chip')].map((c) => c.textContent.trim()), expanded: document.querySelector('.tpl-chip')?.getAttribute('aria-expanded'), menus: [...document.querySelectorAll('.menu-popover')].map((m) => m.className), hidden: document.querySelector('.tpl-chip')?.offsetParent === null })`)));
    }],
    ['05-templates', async (app) => { await app.eval(`document.getElementById('templates-link').click()`); await app.sleep(900); }],
    ['06-template-editor', async (app) => { await app.eval(`document.getElementById('templates-link').click()`); await app.sleep(700); await app.eval(clickText('button', lang === 'en' ? 'Edit' : 'Editar')); await app.sleep(700); }],
    ['07-folders', async (app) => { await app.eval(`document.getElementById('home-link').click()`); await app.sleep(900); await app.eval(`document.getElementById('folders')?.scrollIntoView?.()`); await app.sleep(500); }],
    ['08-search', async (app) => { await app.eval(`document.getElementById('home-link').click()`); await app.sleep(900); await app.eval(`document.getElementById('search').focus()`); await app.eval(`(() => { const s = document.getElementById('search'); s.value = 'Acme'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await app.sleep(900); }],
    ['09-settings', async (app) => { await app.eval(`document.getElementById('settings-link').click()`); await app.sleep(900); }],
    ['10-ai-providers', async (app) => { await app.eval(`document.getElementById('settings-link').click()`); await app.sleep(700); await app.eval(clickText('.set-nav-item', lang === 'en' ? 'Artificial intelligence' : 'Inteligência artificial')); await app.sleep(900); }],
    ['11-guide', async (app) => { await app.eval(`document.getElementById('guide-link').click()`); await app.sleep(900); }],
    ['12-permissions', async (app) => { await app.eval(`document.getElementById('guide-link').click()`); await app.sleep(900); await app.eval(`(() => { const h = [...document.querySelectorAll('*')].filter((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(K.permsTitle)}).pop(); if (!h) throw new Error('seção de permissões não achada'); (h.closest('.step') || h).scrollIntoView({ block: 'start' }); return true; })()`); await app.sleep(600); }],
    ['13-meetings-folder', async (app) => { await app.eval(`document.getElementById('settings-link').click()`); await app.sleep(700); await app.eval(clickText('.set-nav-item', lang === 'en' ? 'Meetings folder' : 'Pasta das reuniões')); await app.sleep(700); }],
    ['14-delete', async (app) => { await open(app, L.plan); await app.sleep(700); await moreMenu(app); await app.sleep(400); await menuItem(app, lang === 'en' ? 'Delete meeting' : 'Apagar reunião'); await app.sleep(700); }],
    ['17-global-chat', async (app) => { await app.eval(`document.getElementById('home-link').click()`); await app.sleep(700); await chat(app, true); await app.sleep(500); await app.eval(`document.getElementById('scope-chip').click()`); await app.sleep(400); await menuItem(app, lang === 'en' ? 'All meetings' : 'Todas as reuniões'); await app.sleep(900); }],
    ['19-email-draft', async (app) => {
      // o rascunho sai da IA de verdade do app, que aqui é o fake-claude dos testes (HOME de teste; ver runLang)
      await open(app, L.plan);
      await app.sleep(700);
      await moreMenu(app);
      await app.sleep(400);
      await menuItem(app, lang === 'en' ? 'Share' : 'Compartilhar');
      await app.sleep(500);
      await menuItem(app, lang === 'en' ? 'Follow-up email draft' : 'Rascunho de e-mail de follow-up');
      await app.sleep(1500);
    }],
    ['18-share-menu', async (app) => { await open(app, L.plan); await app.sleep(700); await moreMenu(app); await app.sleep(400); await menuItem(app, lang === 'en' ? 'Share' : 'Compartilhar'); await app.sleep(600); }],
    ['20-nested-folders', async (app) => { await open(app, L.nego); await app.sleep(700); }], // reunião dentro de Clientes › Acme, com a pasta aberta e a reunião destacada
    ['21-notes-annotations', async (app) => { await open(app, L.plan); await app.eval(`document.getElementById('detail').scrollTop = 420`); await app.sleep(900); }],
    ['22-vocabulary-participants', async (app) => {
      await app.eval(`document.getElementById('settings-link').click()`);
      await app.sleep(700);
      await app.eval(clickText('.set-nav-item', lang === 'en' ? 'Vocabulary' : 'Vocabulário'));
      await app.sleep(700);
      // termos reais no vocabulário (Enter cria o chip e grava), e a linha de participantes logo abaixo
      for (const term of K.vocab) {
        await app.eval(`(() => { const i = document.getElementById('vocab-input'); i.value = ${JSON.stringify(term)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
        await app.sleep(250);
      }
      await app.sleep(900);
    }],
    ['23-speakers', async (app) => { await open(app, L.kick); await app.sleep(700); await tab(app, lang === 'en' ? 'Transcript' : 'Transcrição'); await app.sleep(700); await app.eval(`(() => { const b = document.querySelector('.t-who-btn'); if (!b) throw new Error('nenhum falante sem nome'); b.click(); return true; })()`); await app.sleep(600); }],
    ['24-calendar', async (app) => { await homeReloaded(app); }], // agenda do dia, sem lembretes
    ['25-home', async (app) => { await homeReloaded(app); }], // Início com "Para hoje" (rodada própria, com lembretes)
    ['26-ideas', async (app) => { await open(app, L.nego); await app.sleep(700); await tab(app, lang === 'en' ? 'Ideas' : 'Ideias'); await app.sleep(700); }],
    ['27-warroom', async (app) => { await open(app, L.nego); await app.sleep(700); await tab(app, lang === 'en' ? 'Investigation' : 'Investigação'); await app.sleep(700); }],
    ['28-attachments', async (app) => {
      // anexos pelo mesmo caminho do app (rice.attachData): um PNG gerado no canvas e dois textos fictícios
      const result = await app.eval(`(async () => {
        try {
        const ms = await window.rice.listMeetings();
        const m = ms.find((x) => x.title === ${JSON.stringify(L.plan)});
        const c = document.createElement('canvas'); c.width = 320; c.height = 200;
        const g = c.getContext('2d'); g.fillStyle = '#3b6e5c'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.font = '26px sans-serif'; g.fillText(${JSON.stringify(K.attachImage)}, 20, 110);
        const png = await new Promise((r) => c.toBlob(r, 'image/png'));
        await window.rice.attachData(m.dir, ${JSON.stringify(lang === 'en' ? 'diagram-pilot.png' : 'diagrama-piloto.png')}, await png.arrayBuffer());
        for (const [name, text] of ${JSON.stringify(K.attachFiles)}) await window.rice.attachData(m.dir, name, new TextEncoder().encode(text).buffer);
        const files = await window.rice.attachList(m.dir);
        return JSON.stringify({ count: files.length });
        } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
      })()`);
      const outcome = JSON.parse(result);
      if (outcome.error || outcome.count < 3) throw new Error(`anexos não gravados: ${outcome.error || outcome.count}`);
      await open(app, L.plan);
      await app.eval(`document.getElementById('detail').scrollTop = document.getElementById('detail').scrollHeight`);
      await app.sleep(1200);
    }],
    ['29-settings-sections', async (app) => { await app.eval(`document.getElementById('settings-link').click()`); await app.sleep(700); await app.eval(clickText('.set-nav-item', K.agendaNav)); await app.sleep(900); }],
    ['30-light-model', async (app) => {
      await app.eval(`document.getElementById('settings-link').click()`);
      await app.sleep(700);
      await app.eval(clickText('.set-nav-item', lang === 'en' ? 'Artificial intelligence' : 'Inteligência artificial'));
      await app.sleep(900);
      // o menu do "Modelo leve" aberto, com as opções
      await app.eval(`(() => { const row = [...document.querySelectorAll('.set-row')].find((r) => r.querySelector('.set-label')?.textContent.trim() === ${JSON.stringify(K.lightLabel)}); if (!row) throw new Error('linha do modelo leve não achada'); row.scrollIntoView({ block: 'center' }); row.querySelector('.menu-select-btn').click(); return true; })()`);
      await app.sleep(900);
    }],
  ];
};

async function runLang(lang, group) {
  const out = join(repo, 'docs/images', lang);
  mkdirSync(out, { recursive: true });
  // pasta fixa e recriada a cada execução: o mesmo conteúdo sempre, e o caminho da barra lateral não é o temporário do sistema
  const root = `/tmp/rice-docs-${lang}`;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  // HOME de teste: ~/.local/bin/claude aponta para o fake-claude dos testes, que devolve o rascunho de e-mail fictício
  const home = `/tmp/rice-docs-home-${lang}`;
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  symlinkSync(join(repo, 'tests/fixtures/fake-claude.mjs'), join(home, '.local', 'bin', 'claude'));
  // os pesos do modelo de transcrição ficam em ~/Library/Application Support/Rice/models: só essa pasta é ligada no HOME de teste
  const dataDir = join(home, 'Library', 'Application Support', 'Rice');
  mkdirSync(dataDir, { recursive: true });
  symlinkSync(join(homedir(), 'Library', 'Application Support', 'Rice', 'models'), join(dataDir, 'models'));
  const K = C[lang];
  const emailReply = `${lang === 'en' ? 'Subject' : 'Assunto'}: ${K.email.subject}\n\n${K.email.body}`;
  const app = await launch({
    settings: {
      root,
      uiLanguage: lang,
      transcriptionLanguage: lang === 'en' ? 'en' : 'pt',
      ai: { provider: 'claude-sub', models: { 'claude-sub': 'claude-sonnet-5-5' }, verified: { 'claude-sub': true }, light: 'auto' },
    },
    size: [W, H],
    seed: (_tmpRoot) => seed(lang)(root),
    env: {
      HOME: home,
      FAKE_CLAUDE_MODE: 'text',
      FAKE_CLAUDE_TEXT: emailReply,
      FAKE_CALENDAR_ACCESS: 'granted',
      FAKE_REMINDERS_ACCESS: group.reminders ? 'granted' : 'notDetermined',
      FAKE_DETECTOR_LIST: JSON.stringify([
        { id: 'e1', title: lang === 'en' ? 'Weekly Product' : 'Weekly Produto', start: iso(ahead(2)), end: iso(ahead(2.5)), url: null, allDay: false, calendar: 'Work', attendees: 5 },
        { id: 'e2', title: lang === 'en' ? 'Acme call' : 'Call com Acme', start: iso(ahead(4)), end: iso(ahead(4.75)), url: null, allDay: false, calendar: 'Work', attendees: 3 },
      ]),
      FAKE_DETECTOR_REMINDERS: group.reminders ? JSON.stringify([
        { id: 'r1', title: lang === 'en' ? 'Send Acme proposal' : 'Enviar proposta ao Acme', due: iso(day(0, 9, 0)), hasTime: true, overdue: false, list: 'Work' },
        { id: 'r2', title: lang === 'en' ? 'Review pilot budget' : 'Revisar orçamento do piloto', due: iso(day(-1, 17, 0)), hasTime: true, overdue: true, list: 'Work' },
      ]) : '[]',
    },
  });
  const failed = [];
  try {
    await app.sleep(2000);
    // espera a lista da barra lateral carregar (no primeiro lançamento de um idioma ela pode demorar)
    for (let i = 0; i < 20 && Number(await app.eval(`document.querySelectorAll('.meeting').length`)) < 6; i++) await app.sleep(1000);
    console.log(`${lang}: reuniões vistas pelo app =`, await app.eval(`window.rice.listMeetings().then((m) => m.length)`), '| linhas no DOM =', await app.eval(`document.querySelectorAll('.meeting').length`), '| pastas no DOM =', await app.eval(`document.querySelectorAll('.folder-row').length`), '| erros?', await app.eval(`window.__docsErr || ''`));
    await app.theme('dark');
    const only = process.env.DOCS_ONLY ? process.env.DOCS_ONLY.split(',') : null;
    for (const [name, step] of scenes(lang).filter(([name]) => (name === '25-home') === group.reminders && (!only || only.includes(name)))) {
      try {
        // cada cena começa limpa: sem busca digitada, sem menu aberto
        await app.eval(`(() => { document.getElementById('search-clear')?.click(); window.RiceActionMenu?.close(); [...document.querySelectorAll('[role=dialog] button')].find((b) => /^(Cancelar|Cancel|Fechar|Close)$/.test(b.textContent.trim()))?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
        await app.sleep(300);
        await step(app);
        const file = join(out, `${name}.png`);
        await app.shot(file, { x: 0, y: 0, width: W, height: H });
        execFileSync('sips', ['-z', String(H), String(W), file], { stdio: 'ignore' }); // 2400x1520 da tela de retina → 1200x760
        console.log(`ok ${lang} ${name}`);
      } catch (err) {
        failed.push(`${lang} ${name}: ${err.message}`);
        console.log(`FALHOU ${lang} ${name}: ${err.message}`);
      }
    }
  } finally {
    await app.close();
  }
  return failed;
}

const failures = [];
for (const lang of langs) {
  failures.push(...(await runLang(lang, { reminders: false })));
  failures.push(...(await runLang(lang, { reminders: true })));
}
console.log(failures.length ? `\nnão capturado (${failures.length}):\n${failures.join('\n')}` : '\ntodas as cenas capturadas');
