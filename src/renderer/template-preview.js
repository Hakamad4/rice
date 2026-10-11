// Pré-visualização das seções de um template (cartão nas notas vazias, mini prévia no seletor). Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** `options.compact`: sem o aviso "O Rice vai preencher…" (usado na prévia do seletor). */
  /** Prévia de um template de ideias: nome, descrição completa, a instrução (resumida) e as categorias como chips. */
  function renderIdeas(template) {
    const short = template.instruction.length > 220 ? `${template.instruction.slice(0, 219)}…` : template.instruction;
    const nodes = [el('div', { className: 'tpl-preview-title' }, [el('span', { className: 'tpl-ico' }, [window.RiceIcons.icon(template.icon || 'lightbulb')]), document.createTextNode(template.title)])];
    if (template.description) nodes.push(el('p', { className: 'tpl-preview-desc', textContent: template.description }, []));
    nodes.push(el('h3', { className: 'tpl-preview-heading', textContent: window.RiceI18n.t('itpl.instruction') }, []), el('p', { className: 'tpl-preview-section-desc', textContent: short }, []));
    if (template.categories.length > 0) nodes.push(el('h3', { className: 'tpl-preview-heading', textContent: window.RiceI18n.t('itpl.categories.read') }, []), el('div', { className: 'tpl-chips' }, template.categories.map((c) => el('span', { className: 'tpl-sec-chip', textContent: c }, []))));
    return el('div', { className: 'tpl-preview' }, nodes);
  }

  function render(template, options) {
    if (options && options.kind === 'ideas') return renderIdeas(template);
    const compact = Boolean(options && options.compact);
    const nodes = [el('div', { className: 'tpl-preview-title' }, [el('span', { className: 'tpl-ico' }, [window.RiceIcons.icon(template.icon || 'file-text')]), document.createTextNode(template.title)])];
    if (template.description) nodes.push(el('p', { className: 'tpl-preview-desc', textContent: template.description }, []));
    for (const s of template.sections) {
      nodes.push(el('h3', { className: 'tpl-preview-heading', textContent: s.heading }, []));
      if (s.description) nodes.push(el('p', { className: 'tpl-preview-section-desc', textContent: s.description }, []));
    }
    if (!compact) nodes.push(el('p', { className: 'tpl-preview-note', textContent: window.RiceI18n.t('tpl.preview.note') }, []));
    return el('div', { className: 'tpl-preview' }, nodes);
  }

  window.RiceTemplatePreview = { render };
})();
