// Campo de termos em "chips": Enter ou vírgula cria, × remove, Backspace no campo vazio remove o último,
// colar várias linhas cria vários, repetidos (sem diferenciar maiúsculas) são ignorados. Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const SPLIT = /[\n\r,;]+/;
  const key = (term) => term.toLocaleLowerCase();

  /** Termos limpos (espaços colapsados, no máximo `max` caracteres), sem repetir. */
  function parse(text, max, into) {
    const out = into ? [...into] : [];
    const seen = new Set(out.map(key));
    for (const piece of String(text || '').split(SPLIT)) {
      const term = piece.replace(/\s+/g, ' ').trim().slice(0, max).trim();
      if (!term || seen.has(key(term))) continue;
      seen.add(key(term));
      out.push(term);
    }
    return out;
  }

  /**
   * `value`: lista inicial. `onChange(items)` roda a cada mudança. `placeholder` e `removeLabel(term)` já vêm traduzidos.
   * Devolve { root, input, items() }.
   */
  function create({ value, placeholder, maxLength, removeLabel, onChange }) {
    const max = maxLength || 60;
    let items = parse((value || []).join('\n'), max);
    const input = el('input', { type: 'text', id: 'vocab-input', placeholder, autocomplete: 'off', spellcheck: false, maxLength: max }, []);
    const root = el('div', { className: 'chips' }, []);

    function draw() {
      root.replaceChildren(
        ...items.map((term) => {
          const remove = el('button', { type: 'button', className: 'chip-x', title: removeLabel(term) }, [window.RiceIcons.icon('x')]);
          remove.setAttribute('aria-label', removeLabel(term));
          remove.onclick = (e) => {
            e.stopPropagation();
            items = items.filter((x) => x !== term);
            draw();
            onChange(items);
            input.focus();
          };
          return el('span', { className: 'chip' }, [el('span', { className: 'chip-text', textContent: term }, []), remove]);
        }),
        input,
      );
    }

    /** Põe o texto como chips; devolve se algo mudou. */
    function add(text) {
      const next = parse(text, max, items);
      if (next.length === items.length) return false;
      items = next;
      draw();
      onChange(items);
      return true;
    }

    input.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        add(input.value);
        input.value = '';
      } else if (e.key === 'Backspace' && input.value === '' && items.length > 0) {
        e.preventDefault();
        items = items.slice(0, -1);
        draw();
        onChange(items);
        input.focus();
      }
    };
    input.onpaste = (e) => {
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (!SPLIT.test(text)) return; // uma palavra só: o campo trata como texto normal
      e.preventDefault();
      add(input.value + text);
      input.value = '';
    };
    input.onblur = () => {
      if (input.value.trim() && add(input.value)) input.value = '';
    };
    root.onclick = () => input.focus();
    draw();
    return { root, input, items: () => [...items] };
  }

  window.RiceChips = { create, parse };
})();
