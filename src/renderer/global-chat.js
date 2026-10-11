// Chat entre reuniões: citações [n] viram links seguros para as reuniões e a linha de "Fontes".
// Só createElement/textContent: o texto da IA nunca passa por innerHTML.
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const CITE_GROUP = /(?:\[\d{1,2}\]\s*)+/g;

  function shortDate(iso) {
    // só a data (AAAA-MM-DD) vira meia-noite UTC no Date: um dia antes no Brasil; lê como data local
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(`${iso}T12:00:00`) : new Date(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(window.RiceI18n.locale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
  }

  function citeButton(citation, onOpen) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cite';
    b.textContent = String(citation.n);
    b.title = `${citation.title} — ${shortDate(citation.date)}`;
    b.setAttribute('aria-label', `${t('gchat.open-meeting')}: ${citation.title}`);
    b.onclick = () => onOpen(citation);
    return b;
  }

  /** Troca os "[1]", "[2][3]" do texto (já renderizado) por botões para as reuniões citadas. Números sem reunião ficam como texto. Devolve os números citados. */
  function linkCitations(root, citations, onOpen) {
    const byN = new Map(citations.map((c) => [c.n, c]));
    const cited = new Set();
    const walker = document.createTreeWalker(root, 4);
    const texts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (/\[\d{1,2}\]/.test(node.nodeValue)) texts.push(node);
    for (const node of texts) {
      const value = node.nodeValue;
      const parts = [];
      let at = 0;
      for (const m of value.matchAll(CITE_GROUP)) {
        const nums = [...m[0].matchAll(/\[(\d{1,2})\]/g)].map((x) => Number(x[1]));
        const known = nums.filter((n) => byN.has(n));
        if (known.length === 0) continue;
        if (m.index > at) parts.push(document.createTextNode(value.slice(at, m.index).replace(/\s+$/, m.index > 0 ? ' ' : '')));
        for (const n of known) {
          cited.add(n);
          parts.push(citeButton(byN.get(n), onOpen));
        }
        const unknown = nums.filter((n) => !byN.has(n));
        if (unknown.length > 0) parts.push(document.createTextNode(unknown.map((n) => `[${n}]`).join('')));
        at = m.index + m[0].length;
      }
      if (parts.length === 0) continue;
      if (at < value.length) parts.push(document.createTextNode(value.slice(at)));
      node.replaceWith(...parts);
    }
    return cited;
  }

  /** "Fontes: Título · data …" só com as reuniões que a resposta citou, em ordem. */
  function sourcesLine(citations, cited, onOpen) {
    const list = citations.filter((c) => cited.has(c.n)).sort((a, b) => a.n - b.n);
    if (list.length === 0) return null;
    const box = document.createElement('div');
    box.className = 'sources';
    const label = document.createElement('span');
    label.className = 'sources-label';
    label.textContent = t('gchat.sources');
    box.append(label);
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'source-link';
      b.textContent = `${c.n}. ${c.title} · ${shortDate(c.date)}`;
      b.title = t('gchat.open-meeting');
      b.onclick = () => onOpen(c);
      box.append(b);
    }
    return box;
  }

  /** Preenche a resposta: Markdown seguro, citações como botões e a linha de fontes. */
  function fillAnswer(answerNode, message, markdown, citations, onOpen) {
    answerNode.classList.remove('streaming');
    answerNode.replaceChildren(markdown);
    const cited = linkCitations(answerNode, citations, onOpen);
    const sources = sourcesLine(citations, cited, onOpen);
    if (sources) message.append(sources);
  }

  window.RiceGlobalChat = { linkCitations, sourcesLine, fillAnswer };
})();
