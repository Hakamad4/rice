// Tela "Templates": lista, criar, duplicar, editar e apagar. Só createElement/textContent.
(function () {
  const MAX_SECTIONS = 12;
  const tr = (key, vars) => window.RiceI18n.t(key, vars);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  let fieldSeq = 0;
  /** Campo do formulário: rótulo 12px/500 --muted com 6px até o controle; `hint` (12px --muted) embaixo, se houver. */
  function field(label, control, hint) {
    if (!control.id) control.id = `tpl-field-${++fieldSeq}`;
    return el('div', { className: 'tpl-field' }, [el('label', { className: 'tpl-label', htmlFor: control.id, textContent: label }, []), control, ...(hint ? [el('p', { className: 'tpl-field-hint', textContent: hint }, [])] : [])]);
  }
  /** Rodapé do editor: hairline e 24px acima das ações; "Restaurar padrão", se houver, vai para a direita. */
  function editorFooter(actions, restore) {
    if (restore) restore.classList.add('tpl-restore');
    return el('div', { className: 'tpl-footer' }, [...actions, ...(restore ? [restore] : [])]);
  }

  function button(text, onclick, className) {
    const b = el('button', { textContent: text, className: className || '' }, []);
    b.onclick = onclick;
    return b;
  }

  /** Nova lista com a seção de `index` trocada com a vizinha (delta -1 sobe, +1 desce); fora dos limites não muda nada. */
  function moveSection(sections, index, delta) {
    const to = index + delta;
    if (to < 0 || to >= sections.length || index < 0 || index >= sections.length) return sections.slice();
    const next = sections.slice();
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  }

  const copyOf = (t) => ({
    title: tr('tpl.copy-title', { title: t.title }).slice(0, 80),
    description: t.description,
    sections: t.sections.map((s) => ({ heading: s.heading, description: s.description })),
  });

  /**
   * Bloco de um template, largura total, em 3 linhas: título (emoji + nome inteiro + selos), descrição e ações.
   * Grade de 2 colunas: emoji | conteúdo; descrição e ações alinham com o início do título. Nada com position:absolute.
   * Clicar no título ou no bloco abre a edição.
   */
  function block(t, defaultId, actions, onOpen) {
    const description = t.description || window.RiceI18n.tn('tpl.sections', t.sections.length);
    const name = el('button', { className: 'tpl-name', textContent: t.title, type: 'button' }, []);
    name.onclick = (e) => {
      e.stopPropagation();
      onOpen();
    };
    const node = el('div', { className: 'tpl-block' }, [
      el('span', { className: 'tpl-symbol tpl-ico' }, [window.RiceIcons.icon(t.icon || 'file-text')]),
      el('div', { className: 'tpl-line1' }, [
        name,
        ...(t.id === defaultId ? [el('span', { className: 'tpl-badge', textContent: tr('tpl.badge-default') }, [])] : []),
        ...(t.customized ? [el('span', { className: 'tpl-badge tpl-edited', textContent: tr('tpl.edited') }, [])] : []),
      ]),
      el('p', { className: 'tpl-desc', textContent: description, title: description }, []),
      el('div', { className: 'tpl-actions' }, actions),
    ]);
    // o bloco inteiro é clicável; as ações (botões) cuidam do próprio clique
    node.onclick = (e) => {
      if (!e.target.closest || !e.target.closest('button')) onOpen();
    };
    return node;
  }

  /** Abas "Notas · Ideias" da página (mesmo padrão sublinhado das abas da reunião). */
  function tabs(active, onPick) {
    const node = el('div', { className: 'mt-tabs tpl-tabs', role: 'tablist' }, [['notes', tr('tpl.tab.notes')], ['ideas', tr('tpl.tab.ideas')]].map(([id, label]) => {
      const b = el('button', { type: 'button', className: 'mt-tab', textContent: label }, []);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === active));
      b.onclick = () => id !== active && onPick(id);
      return b;
    }));
    return el('div', { className: 'mt-bar tpl-tabbar' }, [node]);
  }

  /** Botão "Novo template…": ghost de 32px com ícone de linha "plus" (sem emoji); o texto muda com a aba (notas ou ideias). */
  function newTemplateButton(onclick, label) {
    const b = el('button', { type: 'button', className: 'btn ghost tpl-new' }, [window.RiceIcons.icon('plus'), el('span', { textContent: label || tr('tpl.new') }, [])]);
    b.onclick = onclick;
    return b;
  }

  /** Título da página (o mesmo nas duas abas). */
  const header = () => el('h1', { className: 'page-title static', textContent: tr('tpl.title') }, []);

  async function renderList(container, ctx) {
    const rice = window.rice;
    if (!container.firstChild) container.replaceChildren(el('div', { className: 'tpl-head-grid' }, [header(), tabs('notes', (tab) => render(container, { ...ctx, tab }))])); // esqueleto síncrono
    const { templates, defaultId, warnings } = await rice.listTemplates();
    const again = () => renderList(container, ctx);
    const fail = (result) => result.ok === false && ctx.onError && ctx.onError(result.message);
    const nodes = [
      // título à esquerda, "Novo template de ideias" (ghost, 32px, ícone +) centrado no título; abaixo, as abas. Estreito: o botão desce para a direita, sob as abas
      el('div', { className: 'tpl-head-grid' }, [header(), newTemplateButton(() => renderEditor(container, ctx, null)), tabs('notes', (tab) => render(container, { ...ctx, tab }))]),
      el('p', { className: 'hint', textContent: tr('tpl.intro') }, []),
      el('div', { className: 'tpl-default' }, [
        el('span', { className: 'hint', textContent: tr('tpl.default-for-new') }, []),
        window.RiceTemplatePicker.create({
          templates,
          selectedId: defaultId,
          onChoose: async (id) => {
            fail(await rice.setDefaultTemplate(id));
            again();
          },
        }).root,
      ]),
    ];
    if (warnings.length > 0) {
      nodes.push(el('p', { className: 'hint tpl-warning', textContent: window.RiceI18n.tn('tpl.invalid-files', warnings.length), title: warnings.join('\n') }, []));
    }
    const restore = async (t) => {
      if (!(await ctx.confirm(tr('tpl.restore-confirm', { title: t.title }), tr('tpl.restore-action')))) return;
      fail(await rice.restoreTemplate(t.id));
      again();
    };
    const group = (label, items) => {
      nodes.push(el('h2', { className: 'section-title', textContent: label }, []));
      if (items.length === 0) nodes.push(el('p', { className: 'empty', textContent: tr('tpl.none-mine') }, []));
      for (const t of items) {
        const open = () => renderEditor(container, ctx, t);
        // ordem: Editar, Duplicar, Usar como padrão (some no padrão), Restaurar padrão (embutido editado), Apagar (só meus, por último)
        const actions = [button(tr('tpl.edit'), open, 'tpl-act')];
        actions.push(button(tr('tpl.duplicate'), async () => {
          const result = await rice.saveTemplate(copyOf(t));
          if (!result.ok) return fail(result);
          renderEditor(container, ctx, result.template);
        }, 'tpl-act'));
        if (t.id !== defaultId) {
          actions.push(button(tr('tpl.use-default'), async () => {
            fail(await rice.setDefaultTemplate(t.id));
            again();
          }, 'tpl-act'));
        }
        if (t.builtin && t.customized) actions.push(button(tr('tpl.restore'), () => restore(t), 'tpl-act'));
        if (!t.builtin) {
          actions.push(button(tr('tpl.delete'), async () => {
            const ok = await ctx.confirm(tr('tpl.delete-confirm', { title: t.title }), tr('tpl.delete'));
            if (!ok) return;
            fail(await rice.deleteTemplate(t.id));
            again();
          }, 'tpl-act danger'));
        }
        nodes.push(block(t, defaultId, actions, open));
      }
    };
    group(tr('tpl.picker.builtin'), templates.filter((t) => t.builtin));
    group(tr('tpl.picker.mine'), templates.filter((t) => !t.builtin));
    container.replaceChildren(...nodes);
  }

  function renderEditor(container, ctx, template) {
    const draft = template
      ? { id: template.id, title: template.title, description: template.description, sections: template.sections.map((s) => ({ ...s })) }
      : { title: '', description: '', sections: [{ heading: '', description: '' }] };
    const error = el('p', { className: 'feedback bad' }, []);
    const draw = () => {
      const bind = (node, obj, key) => {
        node.value = obj[key];
        node.oninput = () => {
          obj[key] = node.value;
        };
        return node;
      };
      const sections = draft.sections.map((s, i) => {
        const move = (delta) => () => {
          draft.sections = moveSection(draft.sections, i, delta);
          draw();
        };
        const up = button('↑', move(-1));
        up.title = tr('tpl.move-up');
        up.disabled = i === 0;
        const down = button('↓', move(1));
        down.title = tr('tpl.move-down');
        down.disabled = i === draft.sections.length - 1;
        const remove = button('✕', () => {
          draft.sections.splice(i, 1);
          draw();
        });
        remove.title = tr('tpl.remove-section');
        remove.disabled = draft.sections.length === 1;
        return el('div', { className: 'tpl-section' }, [
          el('div', { className: 'tpl-section-fields' }, [
            bind(el('input', { className: 'tpl-input tpl-heading', placeholder: tr('tpl.section-title'), maxLength: 80, ariaLabel: tr('tpl.section-title-n', { n: i + 1 }) }, []), s, 'heading'),
            bind(el('input', { className: 'tpl-input tpl-section-desc', placeholder: tr('tpl.section-desc-ph'), maxLength: 500, ariaLabel: tr('tpl.section-desc-n', { n: i + 1 }) }, []), s, 'description'),
          ]),
          el('div', { className: 'tpl-section-actions' }, [up, down, remove]),
        ]);
      });
      const add = button(tr('tpl.add-section'), () => {
        draft.sections.push({ heading: '', description: '' });
        draw();
      });
      add.disabled = draft.sections.length >= MAX_SECTIONS;
      const save = button(tr('tpl.save'), async () => {
        save.disabled = true;
        const result = await window.rice.saveTemplate(draft);
        if (!result.ok) {
          error.textContent = result.message;
          save.disabled = false;
          return;
        }
        renderList(container, ctx);
      }, 'primary');
      const back = button(tr('tpl.cancel'), () => renderList(container, ctx));
      const customized = Boolean(template && template.builtin && template.customized);
      const restoreBtn = customized
        ? button(tr('tpl.restore'), async () => {
            if (!(await ctx.confirm(tr('tpl.restore-confirm', { title: template.title }), tr('tpl.restore-action')))) return;
            const result = await window.rice.restoreTemplate(template.id);
            if (!result.ok) {
              error.textContent = result.message;
              return;
            }
            renderList(container, ctx);
          })
        : null;
      // formulário com rótulos acima de cada campo (20px entre campos); a nota de "versão que passa a valer" fica antes do primeiro campo
      container.replaceChildren(
        el('h1', { className: 'page-title static', textContent: template ? tr('tpl.edit-title') : tr('tpl.new-title') }, []),
        el('div', { className: 'tpl-form' }, [
          ...(template && template.builtin ? [el('p', { className: 'tpl-edit-note', textContent: customized ? tr('tpl.builtin-edited') : tr('tpl.builtin-hint') }, [])] : []),
          field(tr('tpl.field.name'), bind(el('input', { className: 'tpl-input tpl-title-input', placeholder: tr('tpl.title-ph'), maxLength: 80, ariaLabel: tr('tpl.title-ph') }, []), draft, 'title')),
          field(tr('tpl.field.description'), bind(el('input', { className: 'tpl-input tpl-desc-input', placeholder: tr('tpl.desc-ph'), maxLength: 500, ariaLabel: tr('tpl.desc-label') }, []), draft, 'description')),
          field(tr('tpl.field.sections'), el('div', { className: 'tpl-sections' }, [...sections, add])),
          error,
        ]),
        editorFooter([save, back], restoreBtn),
      );
    };
    draw();
  }

  /** `ctx`: { confirm(message, label) → Promise<boolean>, onError(message)? }. */
  function render(container, ctx) {
    return ctx && ctx.tab === 'ideas' ? window.RiceIdeaTemplates.render(container, ctx) : renderList(container, ctx);
  }

  window.RiceTemplates = { render, moveSection, tabs, header, newButton: newTemplateButton, field, editorFooter };
})();
