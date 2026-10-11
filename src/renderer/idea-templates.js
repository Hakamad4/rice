// Templates > Ideias: lista, criar, duplicar, editar, restaurar e apagar templates do modo ideia. Só createElement/textContent.
(function () {
  const tr = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }
  function button(text, onclick, className) {
    const b = el('button', { textContent: text, className: className || '', type: 'button' }, []);
    b.onclick = onclick;
    return b;
  }

  const copyOf = (x) => ({ title: tr('tpl.copy-title', { title: x.title }).slice(0, 80), description: x.description, instruction: x.instruction, categories: x.categories.slice() });

  function block(x, actions, onOpen) {
    const name = el('button', { className: 'tpl-name', textContent: x.title, type: 'button' }, []);
    name.onclick = (e) => {
      e.stopPropagation();
      onOpen();
    };
    const description = x.description || x.instruction;
    const node = el('div', { className: 'tpl-block' }, [
      el('span', { className: 'tpl-symbol tpl-ico' }, [window.RiceIcons.icon(x.icon || 'lightbulb')]),
      el('div', { className: 'tpl-line1' }, [name, ...(x.customized ? [el('span', { className: 'tpl-badge tpl-edited', textContent: tr('tpl.edited') }, [])] : [])]),
      el('p', { className: 'tpl-desc', textContent: description, title: description }, []),
      ...(x.categories.length ? [el('div', { className: 'tpl-chips itpl-cats' }, x.categories.map((c) => el('span', { className: 'tpl-sec-chip', textContent: c }, [])))] : []),
      el('div', { className: 'tpl-actions' }, actions),
    ]);
    node.onclick = (e) => {
      if (!e.target.closest || !e.target.closest('button')) onOpen();
    };
    return node;
  }

  async function renderList(container, ctx) {
    const rice = window.rice;
    if (!container.firstChild) container.replaceChildren(el('div', { className: 'tpl-head-grid' }, [window.RiceTemplates.header(), window.RiceTemplates.tabs('ideas', (tab) => window.RiceTemplates.render(container, { ...ctx, tab }))])); // esqueleto síncrono
    const { templates, warnings } = await rice.listIdeaTemplates();
    const again = () => renderList(container, ctx);
    const fail = (result) => result.ok === false && ctx.onError && ctx.onError(result.message);
    const nodes = [
      // mesma grade da aba Notas: título, botão "Novo template de ideias" (ghost 32px com +) e as abas
      el('div', { className: 'tpl-head-grid' }, [window.RiceTemplates.header(), window.RiceTemplates.newButton(() => renderEditor(container, ctx, null), tr('itpl.new')), window.RiceTemplates.tabs('ideas', (tab) => window.RiceTemplates.render(container, { ...ctx, tab }))]),
      el('p', { className: 'hint', textContent: tr('itpl.intro') }, []),
    ];
    if (warnings.length > 0) nodes.push(el('p', { className: 'hint tpl-warning', textContent: window.RiceI18n.tn('tpl.invalid-files', warnings.length), title: warnings.join('\n') }, []));
    const group = (label, items) => {
      nodes.push(el('h2', { className: 'section-title', textContent: label }, []));
      if (items.length === 0) nodes.push(el('p', { className: 'empty', textContent: tr('tpl.none-mine') }, []));
      for (const x of items) {
        const open = () => renderEditor(container, ctx, x);
        const actions = [button(tr('tpl.edit'), open, 'tpl-act')];
        actions.push(button(tr('tpl.duplicate'), async () => {
          const result = await rice.saveIdeaTemplate(copyOf(x));
          if (!result.ok) return fail(result);
          renderEditor(container, ctx, result.template);
        }, 'tpl-act'));
        if (x.builtin && x.customized) {
          actions.push(button(tr('tpl.restore'), async () => {
            if (!(await ctx.confirm(tr('tpl.restore-confirm', { title: x.title }), tr('tpl.restore-action')))) return;
            fail(await rice.restoreIdeaTemplate(x.id));
            again();
          }, 'tpl-act'));
        }
        if (!x.builtin) {
          actions.push(button(tr('tpl.delete'), async () => {
            if (!(await ctx.confirm(tr('tpl.delete-confirm', { title: x.title }), tr('tpl.delete')))) return;
            fail(await rice.deleteIdeaTemplate(x.id));
            again();
          }, 'tpl-act danger'));
        }
        nodes.push(block(x, actions, open));
      }
    };
    group(tr('tpl.picker.builtin'), templates.filter((x) => x.builtin));
    group(tr('tpl.picker.mine'), templates.filter((x) => !x.builtin));
    container.replaceChildren(...nodes);
  }

  function renderEditor(container, ctx, template) {
    const draft = template
      ? { id: template.id, title: template.title, description: template.description, instruction: template.instruction, categories: template.categories.slice() }
      : { title: '', description: '', instruction: '', categories: [] };
    const error = el('p', { className: 'feedback bad' }, []);
    const bind = (node, key) => {
      node.value = draft[key];
      node.oninput = () => {
        draft[key] = node.value;
      };
      return node;
    };
    const chips = window.RiceChips.create({
      value: draft.categories,
      placeholder: tr('itpl.categories-ph'),
      removeLabel: (term) => tr('itpl.categories-remove', { term }),
      onChange: () => {
        draft.categories = chips.items();
      },
    });
    const customized = Boolean(template && template.builtin && template.customized);
    const save = button(tr('tpl.save'), async () => {
      save.disabled = true;
      draft.categories = chips.items();
      const result = await window.rice.saveIdeaTemplate(draft);
      if (!result.ok) {
        error.textContent = result.message;
        save.disabled = false;
        return;
      }
      renderList(container, ctx);
    }, 'primary');
    const restoreBtn = customized
      ? button(tr('tpl.restore'), async () => {
          if (!(await ctx.confirm(tr('tpl.restore-confirm', { title: template.title }), tr('tpl.restore-action')))) return;
          const result = await window.rice.restoreIdeaTemplate(template.id);
          if (!result.ok) {
            error.textContent = result.message;
            return;
          }
          renderList(container, ctx);
        })
      : null;
    const { field, editorFooter } = window.RiceTemplates;
    // mesmo formulário do editor de notas: rótulo acima de cada campo, 20px entre campos, rodapé com hairline
    container.replaceChildren(
      el('h1', { className: 'page-title static', textContent: template ? tr('itpl.edit-title') : tr('itpl.new-title') }, []),
      el('div', { className: 'tpl-form' }, [
        ...(template && template.builtin ? [el('p', { className: 'tpl-edit-note', textContent: customized ? tr('tpl.builtin-edited') : tr('tpl.builtin-hint') }, [])] : []),
        field(tr('tpl.field.name'), bind(el('input', { className: 'tpl-input tpl-title-input', placeholder: tr('itpl.title-ph'), maxLength: 80, ariaLabel: tr('itpl.title-ph') }, []), 'title')),
        field(tr('tpl.field.description'), bind(el('input', { className: 'tpl-input tpl-desc-input', placeholder: tr('itpl.desc-ph'), maxLength: 200, ariaLabel: tr('tpl.desc-label') }, []), 'description')),
        field(tr('tpl.field.instruction'), bind(el('textarea', { className: 'tpl-input itpl-instruction', rows: 5, maxLength: 1200, placeholder: tr('itpl.instruction-ph'), ariaLabel: tr('itpl.instruction') }, []), 'instruction'), tr('itpl.instruction-help')),
        field(tr('tpl.field.categories'), chips.root, tr('itpl.categories-help')),
        error,
      ]),
      editorFooter([save, button(tr('tpl.cancel'), () => renderList(container, ctx))], restoreBtn),
    );
  }

  window.RiceIdeaTemplates = { render: renderList };
})();
