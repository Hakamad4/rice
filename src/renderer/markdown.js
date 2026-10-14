// Renderizador de Markdown mínimo e seguro: só createElement/textContent, nunca innerHTML.
(function () {
  const INLINE = [
    // texto do usuário nas notas (marcador invisível posto pela IA): `.from-user`; o que a IA expandiu depois vira `.ai-exp`
    { re: /<!--u(?::\d+)?-->(.*?)<!--\/u-->/, tag: 'span', cls: 'from-user' },
    { re: /`([^`]+)`/, tag: 'code', raw: true },
    { re: /\*\*(.+?)\*\*(?!\*)/, tag: 'strong' },
    { re: /\*(?!\s)([^*]+?)\*/, tag: 'em' },
  ];

  function renderInline(text, parent, doc) {
    let rest = text;
    while (rest) {
      let best = null;
      for (const rule of INLINE) {
        const m = rule.re.exec(rest);
        if (m && (!best || m.index < best.m.index)) best = { rule, m };
      }
      if (!best) {
        parent.append(doc.createTextNode(rest));
        return;
      }
      if (best.m.index > 0) parent.append(doc.createTextNode(rest.slice(0, best.m.index)));
      const el = doc.createElement(best.rule.tag);
      if (best.rule.cls) el.className = best.rule.cls;
      if (best.rule.raw) el.textContent = best.m[1];
      else renderInline(best.m[1], el, doc);
      parent.append(el);
      rest = rest.slice(best.m.index + best.m[0].length);
      if (best.rule.cls === 'from-user' && rest.trim()) {
        const exp = doc.createElement('span');
        exp.className = 'ai-exp';
        renderInline(rest, exp, doc);
        parent.append(exp);
        return;
      }
    }
  }

  /** Citação de captura de tela (`<!--shot:101530-->` numa linha só): vira o nó devolvido por `opts.shot(id)`, ou nada. */
  const SHOT_LINE = /^<!--shot:(\d{6}(?:-\d{1,2})?)-->$/;

  /** `opts.shot(id)`: devolve o nó da miniatura de uma captura DA REUNIÃO ABERTA (ou null). Sem ele, a citação é ignorada. */
  function renderMarkdown(text, doc, opts) {
    const frag = doc.createDocumentFragment();
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    let para = [];
    let list = null; // { tag, el }

    const flushPara = () => {
      if (!para.length) return;
      const p = doc.createElement('p');
      para.forEach((line, i) => {
        if (i > 0) p.append(doc.createElement('br'));
        renderInline(line, p, doc);
      });
      frag.append(p);
      para = [];
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flushPara();
        list = null;
        continue;
      }
      const shot = SHOT_LINE.exec(line);
      if (shot) {
        flushPara();
        list = null;
        const node = opts && typeof opts.shot === 'function' ? opts.shot(shot[1]) : null;
        if (node) frag.append(node);
        continue;
      }
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) {
        flushPara();
        list = null;
        const el = doc.createElement('h' + h[1].length);
        renderInline(h[2], el, doc);
        frag.append(el);
        continue;
      }
      const ul = /^[-*]\s+(.*)$/.exec(line);
      const ol = /^\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) {
          list = { tag, el: doc.createElement(tag) };
          frag.append(list.el);
        }
        let content = (ul || ol)[1];
        const li = doc.createElement('li');
        const task = ul ? /^\[([ xX])\]\s+(.*)$/.exec(content) : null;
        if (task) {
          const box = doc.createElement('input');
          box.type = 'checkbox';
          box.checked = task[1] !== ' ';
          if (opts && typeof opts.onTask === 'function') {
            // notas: marcar a tarefa grava nas notas e reflete nas pendências
            const label = task[2];
            box.onchange = () => opts.onTask(label, box.checked);
          } else box.disabled = true;
          li.className = 'task';
          li.append(box);
          content = task[2];
        }
        renderInline(content, li, doc);
        list.el.append(li);
        continue;
      }
      list = null;
      para.push(line);
    }
    flushPara();
    return frag;
  }

  globalThis.RiceMarkdown = { renderMarkdown };
})();
