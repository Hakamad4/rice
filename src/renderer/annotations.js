// Anotações da reunião (aba Notas): leitura em Markdown no lugar do texto cru; clicar entra em edição no mesmo lugar.
// Só createElement/textContent (o Markdown vem de RiceMarkdown, que também só usa createElement). Salvar continua com quem chama (onChange).
(function () {
  const t = (key, vars) => window.RiceI18n.t(key, vars);
  // item de lista: indentação, marcador ("-", "*" ou "1."), espaço, caixa opcional ("[ ] ") e o conteúdo
  const LIST = /^(\s*)([-*]|\d+\.)(\s+)(\[[ xX]\]\s+)?(.*)$/;

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /**
   * `options`: { value, onChange(text) }. Devolve { heading, body, get/set value, markSaved() }.
   * `heading` é o título "Anotações" (padrão de título de seção) com o "Salvo" discreto ao lado; `body` é o conteúdo que alterna leitura/edição.
   */
  function create(options) {
    let value = options.value || '';
    let editing = false;
    let savedTimer = null;
    const onChange = options.onChange || (() => {});
    const saved = el('span', { className: 'anot-saved', textContent: t('meeting.annotations.saved'), hidden: true }, []);
    saved.setAttribute('role', 'status');
    const heading = el('div', { className: 'anot-head' }, [el('h2', { className: 'section-title', textContent: t('section.annotations') }, []), saved]);
    const body = el('div', { className: 'anot-body' }, []);

    function paintRead() {
      if (!value.trim()) {
        const empty = el('button', { type: 'button', className: 'anot-empty', textContent: t('meeting.annotations-ph') }, []);
        empty.onclick = startEdit;
        body.replaceChildren(empty);
        return;
      }
      const read = el('div', { className: 'anot-read md', tabIndex: 0 }, [window.RiceMarkdown.renderMarkdown(value, document)]);
      read.setAttribute('role', 'button');
      read.setAttribute('aria-label', t('meeting.annotations.edit'));
      read.onclick = startEdit;
      read.onkeydown = (e) => {
        if (e.key === 'Enter') startEdit();
      };
      body.replaceChildren(read);
    }

    function autosize(area) {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight}px`; // sem rolagem interna: a caixa cresce com o texto
    }

    function commit(area, text, caret) {
      area.value = text;
      area.setSelectionRange(caret, caret);
      value = text;
      autosize(area);
      onChange(value);
    }

    function handleKey(area, e) {
      const { selectionStart: start, selectionEnd: end } = area;
      const text = area.value;
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
        return;
      }
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          const lead = /^ {1,2}/.exec(text.slice(lineStart));
          const drop = lead ? lead[0].length : 0;
          commit(area, text.slice(0, lineStart) + text.slice(lineStart + drop), Math.max(lineStart, start - drop));
        } else {
          commit(area, `${text.slice(0, lineStart)}  ${text.slice(lineStart)}`, start + 2);
          area.setSelectionRange(start + 2, end + 2);
        }
        return;
      }
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || start !== end) return;
      const line = LIST.exec(text.slice(lineStart, start));
      if (!line) return;
      e.preventDefault();
      const [, indent, marker, space, box, content] = line;
      if (!content.trim()) {
        // item vazio: Enter sai da lista (apaga o marcador e fica na linha, com a indentação)
        commit(area, text.slice(0, lineStart) + indent + text.slice(start), lineStart + indent.length);
        return;
      }
      const next = /^\d+\.$/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker;
      const insert = `\n${indent}${next}${space}${box ? '[ ] ' : ''}`;
      commit(area, text.slice(0, start) + insert + text.slice(end), start + insert.length);
    }

    function startEdit() {
      if (editing) return;
      editing = true;
      const area = el('textarea', { className: 'anot-edit', value, rows: 3, spellcheck: false }, []);
      area.setAttribute('aria-label', t('section.annotations'));
      area.value = value;
      area.oninput = () => {
        value = area.value;
        autosize(area);
        onChange(value);
      };
      area.onkeydown = (e) => handleKey(area, e);
      area.onblur = () => finish();
      body.replaceChildren(area);
      autosize(area);
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }

    function finish() {
      if (!editing) return;
      editing = false;
      paintRead();
    }

    paintRead();
    return {
      heading,
      body,
      get value() {
        return value;
      },
      set value(next) {
        value = next || '';
        if (editing) {
          const area = body.querySelector('textarea');
          if (area) {
            area.value = value;
            autosize(area);
          }
        } else paintRead();
      },
      /** Depois de salvar: "Salvo" discreto ao lado do título por 2 s. */
      markSaved() {
        saved.hidden = false;
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => (saved.hidden = true), 2000);
      },
    };
  }

  window.RiceAnnotations = { create };
})();
