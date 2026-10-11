// Busca no conteúdo: lista de resultados da barra lateral e o destaque do trecho na reunião aberta.
// Só createElement/textContent, nunca innerHTML.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);

  /** Mesma dobra do main: sem acento e em minúsculas, com o mesmo tamanho do texto. */
  function fold(text) {
    return String(text).normalize('NFC').replace(/[^\x00-\x7f]/g, (ch) => ch.normalize('NFD')[0] || ch).toLowerCase();
  }

  function terms(query) {
    return [...new Set(fold(query).match(/[\p{L}\p{N}]+/gu) || [])];
  }

  const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

  function wordStart(text, term, from) {
    let at = text.indexOf(term, from || 0);
    while (at > 0 && isWord(text[at - 1])) at = text.indexOf(term, at + 1);
    return at;
  }

  /** Texto com os trechos `marks` em <b> (sem fundo amarelo). */
  function marked(text, marks) {
    const nodes = [];
    let at = 0;
    for (const [start, end] of marks || []) {
      if (start > at) nodes.push(document.createTextNode(text.slice(at, start)));
      const b = document.createElement('b');
      b.textContent = text.slice(start, end);
      nodes.push(b);
      at = end;
    }
    if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
    return nodes;
  }

  function shortDate(iso) {
    const date = new Date(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(window.RiceI18n.locale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
  }

  const SOURCE = ['notes', 'annotations', 'transcript', 'folder', 'title'];

  /** A linha de baixo do resultado: o primeiro trecho de conteúdo (notas, anotações, transcrição), senão a pasta, senão o título. */
  function bestHit(result) {
    for (const field of SOURCE) {
      const hit = result.hits.find((h) => h.field === field);
      if (hit) return hit;
    }
    return null;
  }

  function resultNode(result, index) {
    const titleHit = result.hits.find((h) => h.field === 'title');
    const hit = bestHit(result);
    const snippet = hit && hit.field !== 'title' ? [document.createElement('span')] : [];
    const node = document.createElement('div');
    node.className = 'result';
    node.id = `result-${index}`;
    node.dataset.dir = result.dir;
    node.setAttribute('role', 'option');
    const top = document.createElement('div');
    top.className = 'r-top';
    const title = document.createElement('span');
    title.className = 'r-title';
    title.append(...marked(result.title, titleHit ? titleHit.marks : []));
    const date = document.createElement('small');
    date.className = 'r-date';
    date.textContent = shortDate(result.date);
    top.append(title, date);
    node.append(top);
    const line = document.createElement('div');
    line.className = 'r-line';
    const source = document.createElement('span');
    source.className = 'r-src';
    source.textContent = t(`search.in.${hit ? hit.field : 'title'}`);
    line.append(source);
    if (snippet.length > 0) {
      snippet[0].className = 'r-snip';
      snippet[0].append(...marked(hit.snippet, hit.marks));
      line.append(snippet[0]);
    }
    node.append(line);
    node.title = `${result.title} — ${shortDate(result.date)}`;
    return node;
  }

  /**
   * Preenche `box` com os resultados (ou a mensagem de nada encontrado) e liga clique e teclado.
   * Devolve { move(delta), openActive(), setOpen(dir) }; o foco continua no campo de busca (aria-activedescendant).
   */
  function renderResults(box, results, { onOpen, input }) {
    box.replaceChildren();
    let active = -1;
    if (results.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty r-none';
      none.textContent = t('list.none-found');
      box.append(none);
      if (input) input.removeAttribute('aria-activedescendant');
      return { move() {}, openActive() { return false; }, setOpen() {}, count: 0 };
    }
    const nodes = results.map((r, i) => {
      const node = resultNode(r, i);
      node.onclick = () => onOpen(r);
      node.onmousemove = () => select(i, false);
      return node;
    });
    box.append(...nodes);
    function select(i, scroll) {
      active = i;
      nodes.forEach((n, k) => {
        n.classList.toggle('selected', k === i);
        n.setAttribute('aria-selected', String(k === i));
      });
      if (input) {
        if (i >= 0) input.setAttribute('aria-activedescendant', nodes[i].id);
        else input.removeAttribute('aria-activedescendant');
      }
      if (scroll && i >= 0 && nodes[i].scrollIntoView) nodes[i].scrollIntoView({ block: 'nearest' });
    }
    return {
      count: results.length,
      move(delta) {
        select(active < 0 ? (delta > 0 ? 0 : results.length - 1) : (active + delta + results.length) % results.length, true);
      },
      openActive() {
        const r = results[active < 0 ? 0 : active];
        if (!r) return false;
        onOpen(r);
        return true;
      },
      setOpen(dir) {
        nodes.forEach((n) => n.classList.toggle('open', n.dataset.dir === dir));
      },
    };
  }

  const BLOCKS = 'p, li, h1, h2, h3, .t-row';

  /** O bloco (parágrafo, item, fala) com todas as palavras buscadas; sem ele, o que tem mais palavras. Mesma regra do main. */
  function bestBlock(container, words) {
    let best = null;
    let bestCount = 0;
    for (const block of container.querySelectorAll(BLOCKS)) {
      if (block.querySelector(BLOCKS)) continue; // só o mais interno
      const text = fold(block.textContent || '');
      const count = words.filter((w) => wordStart(text, w) >= 0).length;
      if (count > bestCount) {
        best = block;
        bestCount = count;
        if (count === words.length) break;
      }
    }
    return best;
  }

  /** Envolve em <mark> a primeira ocorrência de cada palavra dentro do bloco. */
  function wrapWords(block, words) {
    const marks = [];
    for (const word of words) {
      const walker = document.createTreeWalker(block, 4);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = wordStart(fold(node.nodeValue), word);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const mark = document.createElement('mark');
        mark.className = 'hit-flash';
        range.surroundContents(mark);
        marks.push(mark);
        break;
      }
    }
    return marks;
  }

  const FLASH_MS = 1500;

  /**
   * Rola até o trecho da busca na reunião aberta e o destaca por ~1,5 s. `target` = { terms, field }.
   * Notas e transcrição: marca as palavras no bloco certo. Anotações (textarea): rola e pisca o campo. Nada achado: rola até a seção.
   */
  function revealField(root, terms, field, scrollFallback) {
    if (field === 'annotations') {
      const area = root.querySelector('textarea');
      if (!area) return false;
      area.scrollIntoView({ block: 'center' });
      area.classList.add('hit-flash-box');
      setTimeout(() => area.classList.remove('hit-flash-box'), FLASH_MS + 100);
      return true;
    }
    const container = root.querySelector(field === 'transcript' ? '.transcript' : field === 'notes' ? '.notes-body' : '#page-title');
    if (!container) return false;
    const block = field === 'title' ? container : bestBlock(container, terms);
    if (!block) {
      if (scrollFallback) container.scrollIntoView({ block: 'start' });
      return false;
    }
    const marks = wrapWords(block, terms);
    (marks[0] || block).scrollIntoView({ block: 'center' });
    setTimeout(() => {
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        mark.replaceWith(...mark.childNodes);
        parent.normalize();
      }
    }, FLASH_MS + 100);
    return true;
  }

  /** `target.field` pode ser uma lista (tenta na ordem: notas, depois transcrição). */
  function reveal(root, target) {
    if (!root || !target || !target.terms || target.terms.length === 0) return false;
    const fields = Array.isArray(target.field) ? target.field : [target.field];
    return fields.some((field, i) => revealField(root, target.terms, field, i === fields.length - 1));
  }

  window.RiceSearch = { fold, terms, bestHit, renderResults, reveal, wordStart };
})();
