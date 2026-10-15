// Tela "Como usar o Rice": passo a passo com status ao vivo. Só createElement/textContent.
(function () {
  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of children || []) node.append(child);
    return node;
  }

  /** Passo do checklist: indicador de estado (círculo com o número; pronto = círculo cheio com check de linha), título, estado e corpo alinhado ao título. */
  function step(n, title, done, body, key, stateText) {
    const badge = el('span', { className: 'step-badge' }, done ? [window.RiceIcons.icon('check')] : []);
    if (!done) badge.textContent = String(n);
    badge.dataset.n = String(n);
    const node = el('div', { className: 'step' + (done ? ' done' : '') }, [
      el('div', { className: 'step-head' }, [
        badge,
        el('h3', { textContent: title }, []),
        el('span', { className: 'step-state', textContent: stateText || (done ? t('guide.done') : t('guide.pending')) }, []),
      ]),
      el('div', { className: 'step-body' }, body),
    ]);
    if (key) node.dataset.step = key;
    return node;
  }

  const t = (key, vars) => window.RiceI18n.t(key, vars);
  const p = (text) => el('p', { textContent: text }, []);
  /** Mesma linha das Configurações: rótulo + explicação à esquerda, controle à direita (em coluna quando estreito). */
  function row(label, help, control) {
    return el('div', { className: 'set-row' }, [
      el('div', { className: 'set-text' }, [el('div', { className: 'set-label', textContent: label }, []), ...(help ? [el('p', { className: 'set-help', textContent: help }, [])] : [])]),
      el('div', { className: 'set-control' }, [control]),
    ]);
  }

  /** Lista de status do passo: uma linha por item, com ponto (ok/warn/bad), nome e estado à direita. `items`: [{ tone, name, state, title? }]. */
  function statList(items) {
    return el('ul', { className: 'stat-list' }, items.map((i) =>
      el('li', { className: 'stat-row' }, [
        el('span', { className: `state-dot tone-${i.tone}`, 'aria-hidden': 'true' }, []),
        el('span', { className: 'stat-name', textContent: i.name }, []),
        el('span', { className: 'stat-state', textContent: i.state, ...(i.title ? { title: i.title } : {}) }, []),
      ]),
    ));
  }

  /** Rodapé do passo (mesmo do detalhe das IAs e da Agenda): hairline, status geral à esquerda, ações à direita. */
  function stepFoot(tone, text, actions) {
    return el('div', { className: 'ai-foot' }, [
      el('p', { className: 'ai-status' }, [el('span', { className: `state-dot tone-${tone}` }, []), document.createTextNode(text)]),
      ...(actions.length > 0 ? [el('div', { className: 'ai-actions' }, actions)] : []),
    ]);
  }

  /** Botão do padrão do app (32px): ghost ou primário. */
  function button(text, onclick, className) {
    const b = el('button', { type: 'button', textContent: text, className: `btn ${className || 'ghost'}` }, []);
    b.onclick = onclick;
    return b;
  }

  async function render(container, ctx) {
    const { onClose, focus } = ctx;
    // esqueleto síncrono: título e resumo já na tela; os passos chegam quando o status (IA, modelo, permissões…) estiver pronto
    if (!container.firstChild) container.replaceChildren(el('div', { className: 'guide-mark' }, [window.RiceIcons.icon('rice')]), el('h1', { className: 'page-title static', textContent: t('guide.title') }, []), el('p', { className: 'guide-lead', textContent: t('guide.lead') }, []));
    const rice = window.rice;
    const [settings, ai, asr, perms, google, eventKit, ics] = await Promise.all([
      rice.getSettings(),
      rice.aiStatus(),
      rice.asrStatus(),
      rice.permissionStatus().catch(() => ({ microphone: 'unknown' })),
      rice.googleStatus ? rice.googleStatus().catch(() => ({})) : {},
      rice.eventKitStatus ? rice.eventKitStatus().catch(() => ({ access: 'unknown' })) : { access: 'unknown' },
      rice.icsStatus ? rice.icsStatus().catch(() => ({})) : {},
    ]);
    const refresh = () => render(container, { ...ctx, focus: undefined });

    // 1. Conectar a IA (provedor ativo: Claude, ChatGPT ou Gemini; assinatura ou chave de API)
    const aiConnected = Boolean(ai.providers[ai.active] && ai.providers[ai.active].connected);
    const aiBody = [
      p(t('guide.ai.intro')),
      window.RiceAiProviders.render({
        status: ai,
        onChange: async () => {
          window.dispatchEvent(new CustomEvent('rice:ai-changed'));
          await refresh();
        },
      }),
    ];

    // 4. Permissões: lista de status (microfone tem estado real; o áudio do sistema só é pedido na primeira gravação) e rodapé
    const mic = perms.microphone;
    const micTone = mic === 'granted' ? 'ok' : mic === 'denied' ? 'bad' : 'warn';
    const permBody = [
      p(t('guide.perm.text')),
      statList([
        { tone: micTone, name: t('guide.perm.mic'), state: mic === 'granted' ? t('guide.state.allowed') : mic === 'denied' ? t('guide.state.denied') : t('guide.state.pending') },
        { tone: 'warn', name: t('guide.perm.system'), state: t('guide.perm.system-state') },
      ]),
      stepFoot(micTone, mic === 'granted' ? t('guide.perm.status.ok') : mic === 'denied' ? t('guide.perm.status.denied') : t('guide.perm.status.pending'), [button(t('guide.perm.open'), () => rice.openPrivacy())]),
    ];

    // 5. Modelo: descrição, uma linha de status e (se falhou) o motivo no rodapé
    const asrTone = asr.state === 'ready' ? 'ok' : asr.state === 'failed' ? 'bad' : 'warn';
    const asrState =
      asr.state === 'ready' ? t('guide.state.ready')
      : asr.state === 'failed' ? t('guide.state.failed')
      : asr.state === 'loading' ? (asr.downloadPercent != null ? t('guide.model.downloading', { percent: asr.downloadPercent }) : t('guide.state.loading'))
      : t('guide.state.waiting');
    const modelBody = [p(t('guide.model.text')), statList([{ tone: asrTone, name: t('guide.model.row'), state: asrState }])];
    if (asr.state === 'failed') modelBody.push(stepFoot('bad', t('guide.model.failed', { error: asr.error || t('guide.model.unknown-error') }), []));

    // 7. Ferramentas e MCPs no chat (opcional, avançado): o MESMO interruptor e a MESMA confirmação de Configurações
    const chatTools = window.RiceChatTools.create({
      settings,
      id: 'guide-chat-tools',
      confirm: ctx.confirm || (async () => true),
      onChange: ctx.onChatToolsChange,
      onStatus: () => refresh(),
    });
    const toolsState = await chatTools.status();
    const toolsStatus = el('p', { className: 'ai-status' }, [el('span', { className: `state-dot tone-${toolsState.on ? 'ok' : 'none'}` }, []), document.createTextNode(toolsState.text)]);
    const toolsStepList = el('ol', { className: 'ai-steps' }, [
      ['guide.tools.1', 'claude mcp list'],
      ['guide.tools.2', t('guide.tools.add-cmd')],
      ['guide.tools.3', null],
    ].map(([key, command], i) =>
      el('li', { className: 'ai-step' }, [el('span', { className: 'ai-step-n', textContent: String(i + 1) }, []), el('div', { className: 'ai-step-body' }, [p(t(key)), ...(command ? [window.RiceAiProviders.commandLine(command)] : [])])]),
    ));
    const toolsBody = [
      p(t('guide.tools.text')),
      toolsStepList,
      el('p', { className: 'ai-note-line' }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]), el('span', { textContent: t('guide.tools.risk') }, [])]),
      el('div', { className: 'ai-foot' }, [toolsStatus, el('div', { className: 'ai-actions' }, [chatTools.input])]),
    ];
    if (toolsState.hint) toolsBody.splice(3, 0, el('p', { className: 'hint', textContent: toolsState.hint }, []));

    // 8. Ideias ao vivo e War room: o que é, quando usar, como ligar (1 clique), custo e cuidados
    const warBody = [
      p(t('guide.war.what')),
      el('ul', { className: 'guide-points' }, ['guide.war.when', 'guide.war.how', 'guide.war.types', 'guide.war.cost'].map((key) => el('li', { textContent: t(key) }, []))),
      el('p', { className: 'ai-note-line' }, [el('span', { className: 'ico' }, [window.RiceIcons.icon('info')]), el('span', { textContent: t('guide.war.risk') }, [])]),
      ...(ctx.onNewWarRoom ? [el('div', { className: 'ai-foot' }, [el('span', {}, []), el('div', { className: 'ai-actions' }, [button(t('home.new-war'), () => ctx.onNewWarRoom())])])] : []),
    ];

    // 6. Agenda (opcional): Calendário do macOS (recomendado) ou Google direto (avançado)
    const calendar = window.RiceCalendarConnect.summary({ google, eventKit, ics });
    const calendarBody = window.RiceCalendarConnect.render({ google, eventKit, ics, onChange: refresh });

    const howTo = el('ol', { className: 'howto' }, [
      el('li', { textContent: t('guide.rec.1') }, []),
      el('li', { textContent: t('guide.rec.2') }, []),
      el('li', { textContent: t('guide.rec.3') }, []),
      el('li', { textContent: t('guide.rec.4') }, []),
      el('li', { textContent: t('guide.rec.5') }, []),
    ]);

    const done = button(t('guide.close'), async () => {
      await rice.setOnboardingDone();
      onClose();
    }, 'primary');

    const hasPending = !aiConnected || !settings.root || mic !== 'granted' || asr.state !== 'ready';
    // rodapé do guia: o aviso de "reabrir depois" à esquerda e a única ação (primária) à direita da coluna
    const footer = [el('div', { className: 'guide-foot' }, [...(hasPending ? [el('p', { className: 'hint', textContent: t('guide.reopen') }, [])] : []), done])];

    container.replaceChildren(
      el('div', { className: 'guide-mark' }, [window.RiceIcons.icon('rice')]),
      el('h1', { className: 'page-title static', textContent: t('guide.title') }, []),
      el('p', { className: 'guide-lead', textContent: t('guide.lead') }, []),
      step(1, t('guide.step.ai'), aiConnected, aiBody, 'ai'),
      step(2, t('guide.step.folder'), Boolean(settings.root), [
        p(t('guide.folder.text')),
        statList([{ tone: 'ok', name: t('guide.folder.row'), state: settings.rootDisplay || settings.root, title: settings.root }]),
        stepFoot('ok', t('guide.folder.status'), [
          button(t('guide.folder.reveal'), async () => {
            await rice.revealRoot();
          }),
          button(t('guide.folder.change'), async () => {
            await rice.chooseRoot();
            await refresh();
          }),
        ]),
      ]),
      step(3, t('guide.step.language'), true, [
        ...window.RiceLanguage.rows({
          settings,
          row,
          onChange: async () => {
            await refresh();
          },
        }),
      ]),
      step(4, t('guide.step.permissions'), mic === 'granted', permBody),
      step(5, t('guide.step.model'), asr.state === 'ready', modelBody),
      step(6, t('guide.step.calendar'), calendar.done, calendarBody, 'calendar', calendar.text),
      step(7, t('guide.step.tools'), toolsState.on, toolsBody, 'tools', toolsState.on ? toolsState.text : t('guide.optional')),
      step(8, t('guide.step.war'), false, warBody, 'warroom', t('guide.optional')),
      step(9, t('guide.step.record'), false, [
        howTo,
        p(t('guide.privacy')),
      ]),
      step(10, t('guide.step.privacy'), false, [p(t('guide.privacy2'))]),
      step(11, t('guide.step.tip'), false, [p(t('guide.tip'))]),
      ...footer,
    );
    // 6 e 7 são informativos; 5 é opcional: sem selo de pendente
    for (const s of container.querySelectorAll('.step')) {
      const n = s.querySelector('.step-badge').dataset.n;
      if (n === '6' && !s.classList.contains('done')) s.querySelector('.step-state').textContent = t('guide.optional');
      if (n === '9' || n === '10' || n === '11') {
        s.classList.add('info');
        s.querySelector('.step-state').textContent = '';
      }
    }
    if (focus) {
      const target = container.querySelector(`[data-step="${focus}"]`);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
    }
  }

  window.RiceGuide = { render };
})();
