// Gera os prints da documentação (docs/images/<idioma>/NN-nome.png) numa instância ISOLADA e invisível do Rice.
// Dados 100% fictícios (pasta em /tmp, nomes genéricos: Ana, Carlos, Acme), janela 1200x880 capturada em 2x (2400x1760, retina), tema escuro.
// Uso: node scripts/docs-shots.mjs [pt-BR|en]   (sem argumento: os dois idiomas)
// Site: DOCS_RAW=1 DOCS_OUT=/pasta node scripts/docs-shots.mjs (PNG 2x originais, sem reduzir a paleta, fora do repositório).
// Reproduzível: a mesma pasta de dados fictícios é montada a cada execução. Datas da agenda e dos lembretes são
// relativas a hoje (a agenda mostra "hoje"), então o conteúdo é o mesmo, mas as horas dependem do dia da execução.
// Cada cena que não consegue capturar é reportada no final (não some em silêncio).
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { launch } from './perf/cdp-app.mjs';

const repo = resolve(import.meta.dirname, '..');
const langs = process.argv[2] ? [process.argv[2]] : ['pt-BR', 'en'];
const W = 1200;
const H = 880; // alto o bastante para o menu lateral caber inteiro (sem rolagem nem fade nos prints)

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
/** ISO com o fuso local (o formato que o app grava nos registros e nas capturas). */
const localIso = (d) => {
  const two = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}${off >= 0 ? '+' : '-'}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`;
};

/** PNG mínimo (RGB) sem dependências: só para desenhar a "tela compartilhada" fictícia das capturas. */
function pngOf(width, height, pixel) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = pixel(x, y); const o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const head = Buffer.alloc(13); head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** "Slide" fictício (barras ascendentes sobre fundo claro) gravado como JPEG pelo sips do macOS. */
function writeSlideJpeg(file) {
  const bars = [[80, 90], [150, 140], [220, 200], [290, 262]]; // [x, altura]
  const png = pngOf(480, 300, (x, y) => {
    if (y < 44) return [38, 70, 83]; // faixa do título
    if (y > 270 && y < 274) return [190, 190, 184]; // base do gráfico
    for (const [bx, h] of bars) if (x >= bx && x < bx + 46 && y <= 270 && y > 270 - h) return bx === 290 ? [42, 157, 143] : [138, 177, 170];
    if ((y - 44) % 56 === 0 && x > 40 && x < 440) return [232, 230, 224]; // linhas de grade
    return [247, 245, 240];
  });
  const tmpPng = `${file}.png`;
  writeFileSync(tmpPng, png);
  execFileSync('sips', ['-s', 'format', 'jpeg', tmpPng, '--out', file], { stdio: 'ignore' });
  rmSync(tmpPng, { force: true });
}

/**
 * Áudio para o helper falso: voz sintética do `say` do macOS lendo as frases fictícias (nenhuma voz de pessoa), em WAV 16 kHz mono.
 * Dá energia de fala ao detector; o texto da transcrição vem do whisper falso. Sem `say`, cai num tom modulado.
 */
function writeSpeechWav(file, text, voice) {
  try {
    const aiff = `${file}.aiff`;
    execFileSync('say', [...(voice ? ['-v', voice] : []), '-o', aiff, text], { stdio: 'ignore' });
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, file], { stdio: 'ignore' });
    rmSync(aiff, { force: true });
    return;
  } catch {
    // sem voz instalada: tom modulado abaixo
  }
  const rate = 16000;
  const n = rate * 4;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 180 * i) / rate) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate))), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([head, pcm]));
}

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
    shot: { line: 'Olha o gráfico de adoção que estou compartilhando agora.', caption: 'Gráfico de barras com a adoção do piloto crescendo a cada mês' },
    web: { q: 'Qual é o prazo legal para responder a uma notificação de rescisão?', a: 'Depende do que o contrato prevê. Como referência geral, o prazo costuma ser de 30 dias após o recebimento, mas confira a cláusula de rescisão do contrato Acme.', sources: [{ url: 'https://example.com/guia-de-contratos', title: 'Guia de contratos B2B' }, { url: 'https://example.org/prazos-de-rescisao', title: 'Prazos de rescisão' }] },
    savedPrompts: ['O que o Acme pediu de prazo?', 'Quais riscos do piloto ainda estão abertos?', 'Resuma em três frases para a diretoria'],
    liveEvent: 'Alinhamento com Acme',
    liveLines: ['Bom dia, pessoal, vamos começar pelo piloto.', 'O primeiro ponto é o cronograma das próximas semanas.', 'A Ana consolida o roteiro de testes até sexta.', 'Depois voltamos ao orçamento da pesquisa.'],
    liveTitle: 'Alinhamento com Acme',
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
    shot: { line: 'Take a look at the adoption chart I am sharing now.', caption: 'Bar chart with pilot adoption growing every month' },
    web: { q: 'What is the legal deadline to answer a termination notice?', a: 'It depends on what the contract says. As a general reference the deadline is often 30 days after receipt, but check the termination clause of the Acme contract.', sources: [{ url: 'https://example.com/b2b-contracts-guide', title: 'B2B contracts guide' }, { url: 'https://example.org/termination-deadlines', title: 'Termination deadlines' }] },
    savedPrompts: ['What deadline did Acme ask for?', 'Which pilot risks are still open?', 'Summarize in three sentences for the board'],
    liveEvent: 'Acme sync',
    liveLines: ['Good morning, everyone, let us start with the pilot.', 'The first point is the schedule for the next weeks.', 'Ana consolidates the test script by Friday.', 'Then we go back to the research budget.'],
    liveTitle: 'Acme sync',
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
      { id: folderIds.clientes, name: L.folders[2], createdAt: iso(day(-30, 9, 0)), order: 1, retention: { audioDays: 30, meetingMonths: 12 } },
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
      // a Weekly tem uma terceira fala que dispara uma captura de tela (cena 35)
      const trigger = m.title === L.weekly ? line(K.shot.line, 'Ana', '00:02:40') : '';
      writeFileSync(join(dir, 'transcricao.md'), `# ${m.title}\n\n${line(K.transcript[0], 'Ana', '00:00:05')}${line(K.transcript[1], 'Carlos', '00:01:12')}${unnamed}${trigger}`);
      if (m.title === L.weekly) {
        mkdirSync(join(dir, 'capturas'), { recursive: true });
        writeSlideJpeg(join(dir, 'capturas', '110245.jpg'));
        writeFileSync(join(dir, 'capturas.json'), JSON.stringify([{ file: '110245.jpg', at: localIso(new Date(m.at.getTime() + 165000)), offsetMs: 165000, caption: K.shot.caption, segment: '00:02:40', trigger: { segmentAt: '00:02:40', text: K.shot.line } }]));
      }
      // o Contrato Acme tem o recibo de privacidade (cena 39) e uma conversa com a busca na web (cena 34); o aviso de consentimento já foi copiado
      if (m.title === L.contract) {
        const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
        writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, consentNoticeCopiedAt: localIso(new Date(m.at.getTime() + 120000)) }));
        const sent = (offsetMin, kind, text, extra = {}) => appendFileSync(join(dir, '.rice-egress.jsonl'), JSON.stringify({ at: localIso(new Date(m.at.getTime() + offsetMin * 60000)), kind, provider: 'claude-sub', via: 'cli', items: { text, images: 0 }, ok: true, ...extra }) + '\n');
        sent(37, 'notes', 18400, { redacted: 12 });
        sent(41, 'chat', 5200, { web: true });
        sent(48, 'chat', 4800);
        writeFileSync(join(dir, 'notas.md'), K.notes);
        writeFileSync(join(dir, 'chat.jsonl'), JSON.stringify({ at: iso(end), question: K.web.q, answer: K.web.a, sources: K.web.sources }) + '\n');
      }
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
  /** Clica no item de um menu aberto pelo texto (expressão regular, vale para pt e en). */
  const menuMatch = (app, re) => app.eval(`(() => { const n = [...document.querySelectorAll('.action-item')].find((x) => ${re}.test(x.textContent)); if (!n) throw new Error('item de menu não achado: ' + ${JSON.stringify(String(re))}); n.click(); return true; })()`);
  const settingsNav = async (app, label) => { await app.eval(`document.getElementById('settings-link').click()`); await app.sleep(700); await app.eval(clickText('.set-nav-item', label)); await app.sleep(900); };
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
    // ---- funções novas (31 em diante). O terceiro item é o grupo (uma instância do app por grupo; ver GROUPS). ----
    ['31-record-now', async (app) => { await homeReloaded(app); }, 'live'], // evento em andamento: "Gravar agora" na agenda
    ['32-pause', async (app) => {
      // grava de verdade com o helper de áudio falso (tom sintético + frases fictícias), pausa e espera 12 s
      const started = await app.eval(`window.rice.startRecording({ title: ${JSON.stringify(K.liveTitle)} })`);
      if (!started || !started.dir) throw new Error('a gravação de teste não começou');
      await app.eval(`openMeeting(${JSON.stringify(started.dir)}); 0`);
      await app.sleep(1500);
      await app.eval(`document.querySelectorAll('.mt-tab')[1].click(); 0`);
      await app.sleep(10000);
      const pause = () => app.eval(`document.getElementById('pause').click(); 0`);
      await pause(); // primeira pausa (curta): ao continuar, o marcador "pausado hh:mm–hh:mm" entra na transcrição
      await app.sleep(3500);
      await pause();
      await app.sleep(5000);
      await pause(); // segunda pausa: "Continuar · 00:12" no botão
      await app.sleep(13300);
    }, 'live'],
    ['33-saved-questions', async (app) => { await open(app, L.plan); await app.sleep(700); await chat(app, true); await app.sleep(600); await app.eval(`document.getElementById('prompts-btn').click()`); await app.sleep(700); }],
    ['34-web-search', async (app) => {
      await open(app, L.contract);
      await app.sleep(700);
      await chat(app, true);
      await app.sleep(900);
      await app.eval(`(() => { const b = document.getElementById('web-toggle'); if (b.disabled) throw new Error('busca na web indisponível no provedor de teste'); if (b.getAttribute('aria-pressed') !== 'true') b.click(); return true; })()`);
      await app.sleep(700);
    }],
    ['35-screenshots', async (app) => {
      await open(app, L.weekly);
      await app.sleep(700);
      await chat(app, false);
      await tab(app, lang === 'en' ? 'Transcript' : 'Transcrição');
      await app.sleep(1500);
      if (!(await app.eval(`!!document.querySelector('.t-shot img')`))) throw new Error('a miniatura da captura não apareceu na transcrição');
    }],
    ['36-shortcuts', async (app) => { await settingsNav(app, lang === 'en' ? 'Shortcuts' : 'Atalhos'); }],
    ['37-local-model', async (app) => {
      await settingsNav(app, lang === 'en' ? 'Artificial intelligence' : 'Inteligência artificial');
      await app.sleep(1500); // a detecção do servidor local responde depois de abrir a tela
      await app.eval(`(() => { const c = document.querySelector('.ai-card[data-vendor=local]'); if (!c) throw new Error('card Modelo local não achado'); c.querySelector('.ai-head').click(); return true; })()`);
      await app.sleep(900);
      await app.eval(`document.querySelector('.ai-card[data-vendor=local]').scrollIntoView({ block: 'start' }); document.getElementById('detail').scrollTop -= 190; 0`); // deixa o título da seção visível acima do card
      await app.sleep(500);
    }, 'local'],
    ['38-fully-local', async (app) => {
      await settingsNav(app, lang === 'en' ? 'Privacy' : 'Privacidade');
      await app.eval(`(() => { const row = document.getElementById('fully-local') || [...document.querySelectorAll('.set-row')].find((r) => /100% local/.test(r.textContent)); if (!row) throw new Error('opção Modo 100% local não achada'); row.scrollIntoView({ block: 'center' }); return true; })()`);
      await app.sleep(600);
    }, 'fully-local'],
    ['39-privacy-receipt', async (app) => { await open(app, L.contract); await app.sleep(700); await moreMenu(app); await app.sleep(400); await menuMatch(app, /What left|O que saiu/); await app.sleep(1000); }],
    ['40-consent', async (app) => {
      await open(app, L.plan);
      await app.sleep(700);
      await app.eval(`(async () => { const k = (await window.rice.listMeetings()).find((m) => m.title === ${JSON.stringify(L.plan)}); await window.RiceConsent.offer(k.dir); return true; })()`);
      await app.sleep(800);
      if (!(await app.eval(`!!document.querySelector('.consent-toast')`))) throw new Error('o toast de consentimento não apareceu');
    }],
    ['41-retention', async (app) => {
      await app.eval(`document.getElementById('home-link').click()`);
      await app.sleep(700);
      await app.eval(`(() => { const r = [...document.querySelectorAll('.folder-row')].find((x) => x.textContent.includes(${JSON.stringify(L.folders[2])})); if (!r) throw new Error('pasta não achada'); r.querySelector('.f-more').click(); return true; })()`);
      await app.sleep(500);
      await menuMatch(app, /Tempo de guarda|Retention/);
      await app.sleep(800);
    }],
    // Memória e Pendências (Uirapuru): os dados vêm de memorySeed (EXTRA_SEEDS)
    ['42-memory', async (app) => { await app.eval(`document.getElementById('memory-link').click()`); await app.sleep(1200); }],
    ['43-what-to-remember', async (app) => {
      await open(app, L.oneone);
      await app.sleep(1500);
      if (!(await app.eval(`!!document.querySelector('.mem-card') && !document.querySelector('.mem-card').hidden`))) throw new Error('o cartão O que lembrar não apareceu');
    }],
    ['44-follow-ups', async (app) => { await app.eval(`document.getElementById('followups-link').click()`); await app.sleep(1200); }],
    ['45-meeting-alert', async (app) => {
      // O aviso "a reunião vai começar" é uma BrowserWindow própria (alert.html). Aqui a MESMA página é carregada nesta janela invisível de teste
      // (nenhuma janela real é aberta) e um stub faz o papel do preload (alertApi). O fundo neutro é só para a composição da imagem.
      const stub = `window.alertApi = { uiLanguage: ${JSON.stringify(lang)}, onLanguage() {}, onData(cb) { window.__pushAlert = cb; }, act() {} };`;
      await app.setSize(760, 250);
      await app.navigate(pathToFileURL(join(repo, 'src/renderer/alert.html')).href, stub);
      const hm = (d) => d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
      const time = `${hm(ahead(0.1))} – ${hm(ahead(0.85))}`;
      await app.eval(`(() => {
        document.documentElement.style.background = 'linear-gradient(135deg, #4a4f5c 0%, #2b2f3a 100%)';
        Object.assign(document.body.style, { position: 'absolute', right: '56px', top: '40px', width: '420px', height: '116px' });
        window.__pushAlert({ title: ${JSON.stringify(K.liveEvent)}, time: ${JSON.stringify(time)}, color: '#2a9d8f', hasLink: true });
        return true;
      })()`);
      await app.sleep(600);
      return { width: 760, height: 250 };
    }, 'alert'],
    ['46-record-prompt', async (app) => {
      // Notificação NATIVA do macOS (main.ts notify): nada é disparado de verdade. Recriação em HTML do banner, com os textos reais das chaves
      // notify.record.title / .action / .mute, sobre um fundo neutro que cobre a janela só durante a captura.
      const icon = `data:image/png;base64,${readFileSync(join(repo, 'assets/icon/icon.png')).toString('base64')}`;
      await app.setSize(760, 300);
      await app.eval(`(() => {
        const t = (k, v) => window.RiceI18n.t(k, v);
        const el = (tag, css, text) => { const n = document.createElement(tag); n.style.cssText = css; if (text) n.textContent = text; return n; };
        const root = el('div', 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#4a4f5c 0%,#2b2f3a 100%);font:13px/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif;color:#fff');
        root.id = 'docs-overlay';
        const card = el('div', 'position:absolute;right:56px;top:40px;width:360px;padding:14px 16px;border-radius:22px;background:rgba(58,58,60,.86);box-shadow:0 8px 30px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.08)');
        const head = el('div', 'display:flex;gap:12px;align-items:center');
        const img = document.createElement('img'); img.src = ${JSON.stringify(icon)}; img.style.cssText = 'width:38px;height:38px;border-radius:9px';
        const texts = el('div', 'min-width:0');
        texts.append(el('div', 'font-weight:600;font-size:13px', t('notify.record.title', { title: ${JSON.stringify(K.liveEvent)} })), el('div', 'opacity:.6;font-size:12px;margin-top:2px', 'Rice'));
        head.append(img, texts);
        const actions = el('div', 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end');
        const btn = (text, strong) => el('div', 'padding:5px 12px;border-radius:8px;font-size:12px;background:' + (strong ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.16)') + ';color:' + (strong ? '#1c1c1e' : '#fff') + (strong ? ';font-weight:600' : ''), text);
        actions.append(btn(t('notify.record.mute', { app: 'Zoom' }), false), btn(t('notify.record.action'), true));
        card.append(head, actions);
        root.append(card);
        document.body.append(root);
        return true;
      })()`);
      await app.sleep(500);
      return { width: 760, height: 300 };
    }],
    ['47-calendar-connect', async (app) => {
      await settingsNav(app, K.agendaNav);
      // abre o "Conectar direto ao Google (avançado)": o que é lido (só os eventos) e o passo a passo ficam visíveis ao lado do Calendário do macOS
      await app.eval(`(() => { const h = [...document.querySelectorAll('*')].filter((x) => x.children.length === 0 && /Conectar direto ao Google|Connect directly to Google/.test(x.textContent)).pop(); if (!h) throw new Error('card do Google não achado'); (h.closest('button, [role=button], .ai-head, .cal-head') || h).click(); return true; })()`);
      await app.sleep(900);
    }],
    ['48-guide', async (app) => { await app.eval(`showGuide('calendar'); 0`); await app.sleep(1000); }],
  ];
};

/**
 * README: PNG 2x → WebP com 1600 px de largura (nítido na coluna do GitHub, ~80 KB em vez de ~280 KB; o repositório não incha a cada rodada).
 * DOCS_RAW=1 mantém o PNG original (prints do site). Usa o cwebp se existir; senão, o Pillow.
 */
function toReadmeImage(file) {
  if (process.env.DOCS_RAW === '1') return file;
  const webp = file.replace(/\.png$/, '.webp');
  const width = Math.min(1600, imageWidth(file));
  try {
    execFileSync('cwebp', ['-quiet', '-q', '90', '-m', '6', '-sharp_yuv', '-resize', String(width), '0', file, '-o', webp], { stdio: 'ignore' });
  } catch {
    execFileSync('python3', ['-I', '-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("RGB")\nw = int(sys.argv[3])\nim = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) if im.width > w else im\nim.save(sys.argv[2], "WEBP", quality=90, method=6)', file, webp, String(width)], { stdio: 'ignore' });
  }
  rmSync(file, { force: true });
  return webp;
}

function imageWidth(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' });
  return Number(/pixelWidth: (\d+)/.exec(out)?.[1] ?? 1600);
}

/**
 * Grupos de cenas: cada grupo sobe uma instância própria do app (settings e env diferentes). A cena escolhe o grupo no terceiro item;
 * sem ele, vai para 'main'. Para uma função nova que precise de outro ambiente (ex.: 42-memory), acrescente o grupo aqui.
 *   reminders: lembretes liberados (25-home) · live: evento em andamento + helper de áudio falso (31, 32)
 *   local / fully-local: servidor Ollama FALSO em localhost, só para a captura (37, 38)
 */
const GROUPS = {
  main: {},
  reminders: { reminders: true },
  live: { liveEvent: true, fakeAudio: true },
  local: { fakeOllama: true },
  'fully-local': { fakeOllama: true, fullyLocal: true },
  alert: {}, // 45: abre alert.html NESTA janela invisível (só a página do aviso, nada na tela)
};
const sceneGroup = ([name, , group]) => group ?? (name === '25-home' ? 'reminders' : 'main');
/** Semeadores extras (root, lang) chamados depois do seed(); o Uirapuru acrescenta aqui os dados fictícios de memória/pendências. */
const EXTRA_SEEDS = [memorySeed];

/**
 * Memória e Pendências (cenas 42 a 44): fatos fictícios direto em <raiz>/.rice/memory.jsonl, ligados às reuniões já semeadas. O 1:1 ganha
 * participantes e notas para o cartão "O que lembrar" aparecer; a empresa fica em minúsculas de propósito (vem do domínio do e-mail).
 */
function memorySeed(root, lang) {
  const L = T[lang];
  const pt = lang === 'pt-BR';
  const dirOf = (title) => {
    const name = readdirSync(root).find((d) => d.endsWith(` - ${title}`));
    if (!name) throw new Error(`reunião não achada para a memória: ${title}`);
    return join(root, name);
  };
  const dateOf = (title) => JSON.parse(readFileSync(join(dirOf(title), 'meta.json'), 'utf8')).startedAt;
  const src = (title) => ({ dir: dirOf(title), title, date: dateOf(title) });
  const ymd = (offset) => { const d = day(offset, 10, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const one = dirOf(L.oneone);
  const meta = JSON.parse(readFileSync(join(one, 'meta.json'), 'utf8'));
  writeFileSync(join(one, 'meta.json'), JSON.stringify({ ...meta, participants: ['Ana Silva'], participantEmails: ['ana.silva@acme.com'] }));
  writeFileSync(join(one, 'notas.md'), pt ? '## Resumo\n\nConversa rápida com a Ana sobre o piloto e o preço por assento.\n\n## Próximas ações\n\n- [ ] Enviar a proposta revisada para a Ana\n' : '## Summary\n\nQuick chat with Ana about the pilot and the per-seat price.\n\n## Next actions\n\n- [ ] Send Ana the revised proposal\n');
  const stamp = day(-1, 18, 0).toISOString();
  const F = pt
    ? [
        ['request', 'Ana Silva', 'acme', 'preço', 'Ana pediu preço por assento até 30 de novembro', 4, false, L.contract],
        ['commitment', 'Eu', 'acme', 'proposta', 'Enviar à Ana a proposta revisada com o piloto de 30 dias e as três opções de pagamento discutidas na call', -2, true, L.oneone],
        ['decision', 'Ana Silva', 'acme', 'piloto', 'Começar pelo piloto com cinco clientes antes de assinar o contrato', null, false, L.plan],
        ['preference', 'Ana Silva', 'acme', 'contato', 'Prefere resumos curtos por e-mail, sem anexos grandes', null, false, L.oneone],
        ['commitment', 'Carlos Lima', 'acme', 'nda', 'Mandar o NDA assinado e o cadastro de fornecedor atualizado', 2, false, L.contract],
        ['request', 'Eu', 'acme', 'segurança', 'Revisar o questionário de segurança do Acme', 0, true, L.contract],
        ['commitment', 'Eu', 'acme', 'resultados', 'Compartilhar os resultados do piloto', 14, true, L.plan],
        ['commitment', 'Eu', 'acme', 'financeiro', 'Marcar a call com o financeiro da Acme para fechar os termos do contrato', 3, true, L.contract],
        ['request', 'Eu', '', 'onboarding', 'Atualizar o checklist de onboarding', null, true, L.kick],
        ['commitment', 'Marina Costa', 'beta', 'integração', 'Marina vai mandar a lista de integrações que a Beta precisa', 6, false, L.nego],
        ['decision', 'Marina Costa', 'beta', 'preço', 'Fechar o preço por assento só depois do piloto', null, false, L.nego],
      ]
    : [
        ['request', 'Ana Silva', 'acme', 'price', 'Ana asked for a per-seat price until November 30', 4, false, L.contract],
        ['commitment', 'Eu', 'acme', 'proposal', 'Send Ana the revised proposal with the 30-day pilot and the three payment options discussed on the call', -2, true, L.oneone],
        ['decision', 'Ana Silva', 'acme', 'pilot', 'Start with the pilot with five clients before signing the contract', null, false, L.plan],
        ['preference', 'Ana Silva', 'acme', 'contact', 'Prefers short summaries by email, without large attachments', null, false, L.oneone],
        ['commitment', 'Carlos Lima', 'acme', 'nda', 'Send the signed NDA and the updated vendor registration', 2, false, L.contract],
        ['request', 'Eu', 'acme', 'security', 'Review the Acme security questionnaire', 0, true, L.contract],
        ['commitment', 'Eu', 'acme', 'results', 'Share the pilot results', 14, true, L.plan],
        ['commitment', 'Eu', 'acme', 'finance', 'Book the call with the Acme finance team to close the contract terms', 3, true, L.contract],
        ['request', 'Eu', '', 'onboarding', 'Update the onboarding checklist', null, true, L.kick],
        ['commitment', 'Marina Costa', 'beta', 'integration', 'Marina will send the list of integrations Beta needs', 6, false, L.nego],
        ['decision', 'Marina Costa', 'beta', 'price', 'Close the per-seat price only after the pilot', null, false, L.nego],
      ];
  const rows = F.map(([kind, who, org, about, text, due, mine, title], i) => ({ op: 'put', fact: { id: `doc-f${i}`, kind, who, ...(org ? { org } : {}), about, text, ...(due == null ? {} : { due: ymd(due) }), confidence: 0.9, source: src(title), status: 'open', updatedAt: stamp, mine } }));
  rows.push({ op: 'put', fact: { id: 'doc-done', kind: 'commitment', who: 'Eu', org: 'acme', about: 'notas', text: pt ? 'Enviar as notas do kickoff' : 'Send the kickoff notes', confidence: 0.9, source: src(L.kick), status: 'done', updatedAt: stamp, mine: true, doneAt: stamp, doneBy: src(L.oneone) } });
  mkdirSync(join(root, '.rice'), { recursive: true });
  writeFileSync(join(root, '.rice', 'memory.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** Ollama FALSO em 127.0.0.1:11434 (nada de rede): só para a captura do card "Modelo local". */
function startFakeOllama() {
  const server = createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 5200000000 }, { name: 'llama3.2:3b', size: 2000000000 }] }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(11434, '127.0.0.1', () => ok(server)); });
}

async function runLang(lang, groupName) {
  const group = GROUPS[groupName];
  const todo = scenes(lang).filter((scene) => sceneGroup(scene) === groupName && (!process.env.DOCS_ONLY || process.env.DOCS_ONLY.split(',').includes(scene[0])));
  if (todo.length === 0) return [];
  const out = process.env.DOCS_OUT ? join(resolve(process.env.DOCS_OUT), lang) : join(repo, 'docs/images', lang); // DOCS_OUT: outra pasta (ex.: prints do site)
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
  const events = [
    { id: 'e1', title: lang === 'en' ? 'Weekly Product' : 'Weekly Produto', start: iso(ahead(2)), end: iso(ahead(2.5)), url: null, allDay: false, calendar: 'Work', attendees: 5 },
    { id: 'e2', title: lang === 'en' ? 'Acme call' : 'Call com Acme', start: iso(ahead(4)), end: iso(ahead(4.75)), url: null, allDay: false, calendar: 'Work', attendees: 3 },
  ];
  // evento já em andamento (começou há 4 min): o Início mostra "Gravar agora"
  if (group.liveEvent) events.unshift({ id: 'e0', title: K.liveEvent, start: iso(ahead(-4 / 60)), end: iso(ahead(0.45)), url: null, allDay: false, calendar: 'Work', attendees: 4 });
  let fake = null;
  const audioEnv = {};
  if (group.fakeAudio) {
    const wav = '/tmp/rice-docs-tone.wav';
    writeSpeechWav(wav, K.liveLines.join(' '), lang === 'en' ? 'Samantha' : 'Luciana');
    Object.assign(audioEnv, { RICE_PERF_WAV: wav, RICE_AUDIO_BIN: join(repo, 'scripts/perf/fake-rice-audio-wav.mjs'), RICE_WHISPER_SERVER: join(repo, 'scripts/perf/fake-whisper-lines.mjs'), FAKE_WHISPER_LINES: JSON.stringify(K.liveLines) });
  }
  if (group.fakeOllama) fake = await startFakeOllama();
  const ai = group.fullyLocal
    ? { provider: 'local-model', models: { 'local-model': 'qwen3:8b' }, verified: { 'local-model': true }, light: 'auto' }
    : { provider: 'claude-sub', models: { 'claude-sub': 'claude-sonnet-5-5' }, verified: { 'claude-sub': true }, light: 'auto' };
  const app = await launch({
    settings: {
      root,
      uiLanguage: lang,
      transcriptionLanguage: lang === 'en' ? 'en' : 'pt',
      savedPrompts: K.savedPrompts,
      ...(group.fullyLocal ? { fullyLocal: true } : {}),
      ai,
    },
    size: [W, H],
    seed: (_tmpRoot) => { seed(lang)(root); for (const extra of EXTRA_SEEDS) extra(root, lang); },
    env: {
      HOME: home,
      FAKE_CLAUDE_MODE: 'text',
      FAKE_CLAUDE_TEXT: emailReply,
      FAKE_CALENDAR_ACCESS: 'granted',
      FAKE_REMINDERS_ACCESS: group.reminders ? 'granted' : 'notDetermined',
      FAKE_DETECTOR_LIST: JSON.stringify(events),
      FAKE_DETECTOR_REMINDERS: group.reminders ? JSON.stringify([
        { id: 'r1', title: lang === 'en' ? 'Send Acme proposal' : 'Enviar proposta ao Acme', due: iso(day(0, 9, 0)), hasTime: true, overdue: false, list: 'Work' },
        { id: 'r2', title: lang === 'en' ? 'Review pilot budget' : 'Revisar orçamento do piloto', due: iso(day(-1, 17, 0)), hasTime: true, overdue: true, list: 'Work' },
      ]) : '[]',
      ...audioEnv,
    },
  });
  const failed = [];
  try {
    await app.sleep(2000);
    // espera a lista da barra lateral carregar (no primeiro lançamento de um idioma ela pode demorar)
    for (let i = 0; i < 20 && Number(await app.eval(`document.querySelectorAll('.meeting').length`)) < 6; i++) await app.sleep(1000);
    console.log(`${lang}/${groupName}: reuniões vistas pelo app =`, await app.eval(`window.rice.listMeetings().then((m) => m.length)`), '| linhas no DOM =', await app.eval(`document.querySelectorAll('.meeting').length`), '| pastas no DOM =', await app.eval(`document.querySelectorAll('.folder-row').length`), '| erros?', await app.eval(`window.__docsErr || ''`));
    await app.theme('dark');
    for (const [name, step] of todo) {
      try {
        // cada cena começa limpa: sem busca digitada, sem menu aberto, sem aviso de consentimento
        await app.eval(`(() => { document.getElementById('search-clear')?.click(); window.RiceActionMenu?.close(); window.RiceConsent?.hide?.(); document.getElementById('docs-overlay')?.remove(); [...document.querySelectorAll('[role=dialog] button')].find((b) => /^(Cancelar|Cancel|Fechar|Close)$/.test(b.textContent.trim()))?.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
        await app.sleep(300);
        const dims = (await step(app)) || {}; // a cena pode capturar uma área menor (aviso, notificação)
        const file = join(out, `${name}.png`);
        await app.shot(file, { x: 0, y: 0, width: dims.width ?? W, height: dims.height ?? H });
        if (dims.width) await app.setSize(W, H);
        // retina (2400x1520) por padrão: nítido no README e no site; DOCS_SCALE=1 reduz para 1200x760
        if (process.env.DOCS_SCALE === '1') execFileSync('sips', ['-z', String(H), String(W), file], { stdio: 'ignore' });
        toReadmeImage(file);
        console.log(`ok ${lang} ${name}`);
      } catch (err) {
        failed.push(`${lang} ${name}: ${err.message}`);
        console.log(`FALHOU ${lang} ${name}: ${err.message}`);
      }
    }
  } finally {
    await app.close();
    fake?.close();
  }
  return failed;
}

const failures = [];
for (const lang of langs) {
  for (const groupName of Object.keys(GROUPS)) failures.push(...(await runLang(lang, groupName)));
}
console.log(failures.length ? `\nnão capturado (${failures.length}):\n${failures.join('\n')}` : '\ntodas as cenas capturadas');
