// Janelinha flutuante de gravação. Recebe só níveis (0..1); nunca áudio.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  // idioma do app: vem do main de forma síncrona; trocar nas configurações re-aplica na hora
  window.RiceI18n.setLanguage(window.nub.uiLanguage);
  window.RiceI18n.applyDom();
  window.nub.on('ui:language', (language) => {
    window.RiceI18n.setLanguage(language);
    window.RiceI18n.applyDom();
  });
  const MAX_BAR = 16;
  const MIN_BAR = 3;
  const COUNT = 3;
  const bars = Array.from({ length: COUNT }, () => {
    const node = document.createElement('span');
    node.className = 'bar';
    document.getElementById('bars').append(node);
    return node;
  });
  let level = 0;
  let lastLevelAt = 0;

  /** Altura (px) de cada barra para um nível 0..1; em silêncio todas ficam no mínimo (pontinhos). */
  function barHeights(lvl, now) {
    return Array.from({ length: COUNT }, (_, i) => {
      const wobble = 0.55 + 0.45 * Math.sin(now / 140 + i * 1.7);
      return Math.max(MIN_BAR, Math.round(MAX_BAR * lvl * wobble));
    });
  }

  const painted = [];
  function paint() {
    if (document.hidden) return; // janela escondida: nada a animar
    // sem níveis novos por um instante: as barras relaxam sozinhas
    if (Date.now() - lastLevelAt > 400) level *= 0.6;
    barHeights(level, Date.now()).forEach((h, i) => {
      if (painted[i] === h) return; // sem mudança, sem escrita no DOM (ocioso, nada reflui)
      painted[i] = h;
      bars[i].style.height = `${h}px`;
    });
  }

  window.nub.on('nub:level', (levels) => {
    level = Math.max(Number(levels.mic) || 0, Number(levels.sys) || 0);
    lastLevelAt = Date.now();
  });

  // ---- painel de chat -------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const MAX_TURNS = 6;
  let open = false;
  let busy = false;
  let answerNode = null;
  const partials = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function lineNode(who, text, partial) {
    const row = el('p', 'line ' + (window.RiceI18n.isMine(who) ? 'me' : 'other') + (partial ? ' partial' : ''));
    row.append(el('b', '', window.RiceI18n.speaker(who)), document.createTextNode(text));
    return row;
  }

  /** Perto do fim (±48 px)? Só então o que chega puxa para baixo; quem rolou para ler não é arrastado. */
  const nearEnd = (node) => node.scrollHeight - node.scrollTop - node.clientHeight <= 48;

  /** "Pensando…" com três pontos enquanto a resposta não chega; o primeiro trecho (ou o erro) substitui. */
  function thinking() {
    const dots = el('span', 'dots');
    for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
    const node = el('span', 'thinking');
    node.setAttribute('role', 'status');
    node.append(dots, el('span', '', t('chat.thinking')));
    return node;
  }

  function scrollDown(node) {
    node.scrollTop = node.scrollHeight;
  }

  function setOpen(next, info) {
    open = next;
    document.body.classList.remove('hover');
    document.body.classList.toggle('open', next);
    if (next) {
      $('panel-title').textContent = (info && info.title) || t('meeting.default-title');
      $('lines').replaceChildren(...((info && info.lines) || []).map((l) => lineNode(l.who, l.text, false)));
      scrollDown($('lines'));
      $('question').focus();
    } else {
      busy = false;
      answerNode = null;
      partials.clear();
      $('convo').replaceChildren();
      $('question').value = '';
    }
  }

  async function expand() {
    const result = await window.nub.expand();
    if (result && result.ok) setOpen(true, result);
  }

  async function collapse() {
    if (busy) window.nub.cancel();
    setOpen(false);
    await window.nub.collapse();
  }

  async function submit() {
    const input = $('question');
    const question = input.value.trim();
    if (!question || busy) return;
    input.value = '';
    busy = true;
    const convo = $('convo');
    while (convo.children.length >= MAX_TURNS * 2) convo.firstElementChild.remove();
    convo.append(el('p', 'q', question));
    answerNode = el('p', 'a');
    answerNode.append(thinking());
    convo.append(answerNode);
    scrollDown(convo);
    const mine = answerNode;
    const result = await window.nub.ask(question);
    if (mine === answerNode) busy = false;
    if (!open) return;
    mine.textContent = result && result.ok ? result.answer : t('nub.error', { message: (result && result.message) || t('nub.failed') });
    scrollDown(convo);
  }

  window.nub.on('nub:delta', (text) => {
    if (!answerNode || !open) return;
    const stick = nearEnd($('convo'));
    if (answerNode.querySelector('.thinking')) answerNode.textContent = '';
    answerNode.textContent += text;
    if (stick) scrollDown($('convo'));
  });
  window.nub.on('nub:segment', (segment) => {
    if (!open) return;
    const stick = nearEnd($('lines'));
    partials.get(segment.source)?.remove();
    partials.delete(segment.source);
    $('lines').append(lineNode(segment.source, segment.text.trim(), false));
    if (stick) scrollDown($('lines'));
  });
  window.nub.on('nub:partial', (partial) => {
    if (!open) return;
    const stick = nearEnd($('lines'));
    partials.get(partial.source)?.remove();
    const row = lineNode(partial.source, partial.text.trim(), true);
    partials.set(partial.source, row);
    $('lines').append(row);
    if (stick) scrollDown($('lines'));
  });
  window.nub.on('nub:collapsed', () => setOpen(false)); // o main recolheu (a gravação parou)

  // ---- hover: o main detecta o cursor (polling) e avisa; aqui só se anima a barra -------------
  window.nub.on('nub:hover', (on) => {
    if (!open) document.body.classList.toggle('hover', on === true);
  });
  window.nub.on('nub:side', (side) => document.body.classList.toggle('side-left', side === 'left'));

  $('hit').onclick = () => window.nub.openMain();
  $('btns').onclick = () => window.nub.openMain();
  $('chat').onclick = (event) => {
    event.stopPropagation();
    expand();
  };
  $('stop').onclick = (event) => {
    event.stopPropagation();
    window.nub.stop();
  };
  $('pause').onclick = (event) => {
    event.stopPropagation();
    window.nub.pause();
  };
  // pausado: o botão vira "Continuar" (triângulo) em âmbar discreto; as barras de nível ficam paradas
  window.nub.on('nub:state', (state) => {
    const paused = Boolean(state && state.paused);
    document.body.classList.toggle('paused', paused);
    const label = t(paused ? 'rec.resume' : 'rec.pause');
    $('pause-label').textContent = label;
    $('pause').title = t(paused ? 'rec.resume.title' : 'rec.pause.title');
    $('pause').setAttribute('aria-label', $('pause').title);
    $('pause').querySelector('.ico').innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const shapes = paused ? [['path', { d: 'M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z' }]] : [['rect', { x: 6, y: 5, width: 4, height: 14, rx: 1.2 }], ['rect', { x: 14, y: 5, width: 4, height: 14, rx: 1.2 }]];
    for (const [tag, attrs] of shapes) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      svg.append(node);
    }
    $('pause').querySelector('.ico').append(svg);
  });
  $('close').onclick = collapse;
  $('ask').onsubmit = (event) => {
    event.preventDefault();
    submit();
  };
  document.onkeydown = (event) => {
    if (event.key === 'Escape' && open) collapse();
  };
  window.addEventListener('mouseup', () => window.nub.dragEnd());

  paint();
  setInterval(paint, 100);
  window.RiceNub = { barHeights };
})();
