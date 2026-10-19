# Divergências de design do Rice

**Status: todas as sugestões foram aprovadas e aplicadas na Fase 2** (C2: a chave ligada mantém `--switch-on` como token próprio). Abaixo, o levantamento original.

Levantamento de `src/renderer/index.html` (1.113 linhas, quase todas de CSS), `alert.html`, `nub.html`, `src/main/platform/system.ts` e os `style.*` dos scripts. Números de linha são de `index.html` salvo indicação. "Nx" = quantas vezes aparece. Cada item tem uma sugestão; **nada foi alterado no app**. Decida item a item para a Fase 2.

Resumo: 50 variáveis CSS (as ~59 contam as de `nub.html`, como `--pad` e `--btn-w`), mais valores escritos direto: 31 cores hexadecimais e 48 `rgba()` distintos (somando as três telas), 11 tamanhos de fonte, 20 raios, 20 sombras, 8 camadas z-index, 15 alturas de linha e 8 media queries mais 21 container queries.

## Cores

| # | Hoje | Onde | Sugestão |
|---|------|------|----------|
| C1 | `--danger #d6453f` (sem valor no escuro), `--bad #c8443f` / `#ff7a73` (13x) e `#c0392b` como fallback de `--rec` (l.736) | `--danger` 2x; `--bad` 13x; `.shortcut-note.warn` | Um só vermelho de erro: `--danger` com valor claro `#d6453f` e escuro `#ff7a73`; `--bad` vira alias e some na Fase 2; o fallback `#c0392b` sai (`--rec` sempre existe). O `--danger` hoje fica `#d6453f` no escuro. |
| C2 | Dois verdes de sucesso: `--ok #2e9e5b` e `--switch-on #34C759` (escuro `#30D158`); mais `#2e9d5b` (l.762, um dígito de diferença do `--ok`) | `.receipt-summary` usa `#2e9d5b`; `nub.html` repete `#34c759` | `#2e9d5b` → `var(--ok)`. Manter `--switch-on` só se a chave deve imitar o verde do sistema; senão fundir com `--ok`. Decisão de produto. |
| C3 | Três véus: `rgba(0,0,0,.28)` (`.overlay` l.209), `.5` (`.chat-scrim` l.430), `.72` (`.shot-viewer` l.408) | diálogos / chat por cima / visualizador | Tokens `--scrim-soft`, `--scrim`, `--scrim-strong` (já propostos). São intencionais (3 níveis), só precisam de nome. |
| C4 | `#fff` (4x) e `#000` (8x) escritos direto | knob da chave, sombras, sobreposições | `#fff` → `--on-accent`; `#000` só dentro de sombras/véus (ver S1, C3). |
| C5 | `alert.html` usa cores próprias: texto `rgba(0,0,0,.86)`, borda `rgba(0,0,0,.08)`, fundo `rgba(252,252,251,.96)` / `rgba(36,36,36,.96)`, botão primário `#191919`/`#f2f2f0`, barra `#8a8a85` | janela de alerta de reunião | Texto → `--ink`, borda → `--line`, barra → `--muted`, primário → `--ink`/`--bg`. O fundo translúcido vira `color-mix(in srgb, var(--bg) 96%, transparent)`. O escuro `rgba(36,36,36)` não é nenhum token: usar `--sidebar` (`#1e1e1e`) ou `--bg`. |
| C6 | Barra de título do Windows: `#ffffff` / `#191919` em `src/main/platform/system.ts:21`, enquanto `--bg` é `#fcfcfb` / `#191919` | `titleBarOverlay` | Usar `#fcfcfb` no claro (3 níveis de diferença visível na emenda) ou aceitar. |
| C7 | O mini painel (`nub.html`) repete valores do app como literais: `#e0a93b` (= `--warn` escuro), `#86a0f0` (= `--accent` escuro), `rgba(134,160,240,.3)` (≈ `--ring` escuro `.32`), brancos `.06 .08 .1 .12 .14 .18 .45 .55 .6 .85 .88 .92` | `nub.html` (superfície sempre escura) | Usar os tokens escuros e reduzir os brancos translúcidos a 4 níveis: `.08` (fundo de botão), `.1` (linha), `.45` (muted), `.88` (ink). |
| C9 | Cores de marca dos provedores (`#D97757`, gradiente `#4796E3 → #9177C7 → #CA6673`, `#3b3b3b`/`#cfcfcf`) em `.logo-*` (l.852–859) | logos de IA | Manter: são identidade de terceiros, não do Rice. Listar como `brand.*`, fora da escala. |

## Tipografia

| # | Hoje | Onde | Sugestão |
|---|------|------|----------|
| T1 | Tamanhos: 10 (3x), 11 (51x), 12 (96x), 13 (73x), 14 (26x), 15 (8x), 16 (3x), 17 (1x), 20 (2x), 22 (1x), `--title-size` (2x), mono 12 e 12,5 | tudo | Escala fechada 11/12/13/14/15/16/20 + `--title-size`. `10px` (3x) → 11; `17px` (1x) → 16; `22px` (1x) → 20 ou `--title-size`; mono `12.5px` (4x) → 12 ou 13. |
| T2 | Pesos 400 (7x), 500 (25x), 600 (33x), 700 (4x) | `font-weight:700` em 4 lugares | Escala 400/500/600; os 4 usos de 700 → 600. |
| T3 | Alturas de linha: 1,25 / 1,3 (16x) / 1,35 / 1,4 (25x) / 1,45 / 1,5 (27x) / 1,55 / 1,6 (6x) + 16/18/20/24/40 px | tudo | Quatro valores: 1,3 / 1,4 / 1,5 / 1,6. Mapa: 1,25→1,3; 1,35→1,4; 1,45→1,4 ou 1,5; 1,55→1,5 ou 1,6. As alturas em px (20, 16…) ficam apenas dentro de controles de altura fixa. |
| T4 | Quatro grafias da pilha sans: com `ui-sans-serif` (só no `body`) e sem ele (`.kbd-hint`, `.alert`, `nub`, `font: 14px/1.4 …`) | l.27, l.65, `alert.html`, `nub.html` | `--font-sans` para todos. |
| T5 | `font: 13px/1.45 inherit` (1x), l.760 `.consent-edit-block` | consentimento | `font-size: 13px` + `--lh-snug` (1,4) com a família herdada. |

## Raios

| # | Hoje | Onde | Sugestão |
|---|------|------|----------|
| R1 | 5px (2x): `.folder-row .f-more` (l.660), `.meeting .m-more` (l.700) | botões "mais" das linhas | 4px (kbd) ou 6px (`.icon-btn`). Sugiro 6. |
| R2 | 7px (2x): `.wr-filter-btn` (l.274), `.seg-btn` (l.588); `alert button` 7px | botões de segmento e filtro | 6px. Mas o `.segmented` tem raio 10 e padding 3: seg-btn 7 = 10 − 3 (concentricidade correta). Se o contêiner virar 10, manter 7 documentado como "raio interno = externo − padding"; senão 6 ou 8. |
| R3 | 9px (1x): `.nav-badge` (l.358); `nub .act` 9px | selo da navegação / botão do mini painel | `.nav-badge` (contador de 18px de altura, l.358) → `pill` (999px); `nub` → 8px. |
| R4 | 13px (1x): `.consent-close` (l.758) | botão fechar | `pill` (é um botão redondo de 26px: 13 = metade). Idem `#live-jump` 15px (altura 30px) → `pill`. |
| R5 | 14px: `.dialog` (l.211), `body.attach-over::after` (l.329), `.fu-chip` (l.399); 12px: 12 usos; 10px: 18 usos | cartões e superfícies | Escala 4/6/8/10/12/14/pill. Confirmar que diálogo (14) deve ser maior que cartão grande (12) — hoje é. `.fu-chip` 14px com altura 28 é uma pílula: → `pill`. |
| R6 | `nub.html`: 2,5px, 1,5px, 6, 8, 9, 14, 20, 21 px | mini painel | 20/21 → um só valor (a pílula é `--pill-h`/2). 1,5/2,5px são barras de medidor: manter. |
| R7 | `alert.html`: card 12px | alerta | OK (= `xl`). |

## Espaçamento

| # | Hoje | Onde | Sugestão |
|---|------|------|----------|
| S1 | Duas escalas com nomes que colidem: `--gap-3` = 8px e `--space-3` = 12px | 50x `--gap-3`, 45x `--space-3` | Na Fase 2 deixar só `--space-*` e migrar `--gap-n` → `--space-(n−?)`. `gap-1/2/3/4/5/6` = 2/4/8/12/16/24 → `space-05/1/2/3/4/5`. |
| S2 | 6px (39x em `gap`), 10px (16x), 14px (3x), 3px (2x) escritos direto | `gap`, `padding` | 6px e 10px entram na escala (`--space-15`, `--space-25`); 14px → 12 ou 16; 3px → 2 ou 4. |
| S3 | Paddings horizontais de botão: 8, 9, 10, 12, 14, 16 px | `.btn` 14, `.wr-foot .btn` 12, `.wr-drop` 10, chips 9/10 | Três tamanhos: 8 (compacto), 12 (padrão), 16 (primário grande). `.btn` 14 → 12 (ou manter 14 e padronizar o rodapé). |

## Controles

| # | Hoje | Onde | Sugestão |
|---|------|------|----------|
| K1 | Alturas: 22, 24 (11x), 26 (10x), 28 (12x), 30 (4x), 32 (13x), 36 (6x), 38, 40 | botões, chips, linhas | Quatro alturas: 24 / 28 / 32 / 36. **26 → 24 ou 28** (10 usos: `.ev-actions button`, `.wr-filter-btn`, `.wr-pin`, `.wr-drop`…); **30 → 28 ou 32** (`.search-box`, `.meeting`, `#live-jump`, `.folder-row`). |
| K2 | Duas chaves (toggle): padrão 34×20 e a do rodapé da war room 28×16 | l.583 e l.290 | Manter as duas se o rodapé precisa ser compacto; nomear (`switch` e `switch-sm`). |
| K3 | Ícones: 10, 11, 12, 14 (25x), 16, 18, 20, 24, 28 px | `.icon` por contexto | 12 / 14 / 16 (+ 20 para estados vazios). 11 e 18 → 12 e 20. |

## Sombras, movimento e camadas

| # | Hoje | Onde | Sugestão |
|---|------|------|----------|
| S4 | Sombras pequenas: `0 1px 2px rgba(0,0,0,.3)` (knob da chave) e `.14` (item do segmentado) | l.584, l.590 | Uma só (`--shadow-raise`, proposta `.2`). |
| S5 | Sombras de menu: `0 8px 28px .18` (3x), `0 2px 10px .18`, `0 1px 0 + 0 8px 28px .28` (escuro) | menus, popovers | `--shadow-pop` com variante escura (hairline + .28). `0 2px 10px` → `pop`. |
| S6 | Anel de foco em 3 espessuras: 1px, 2px (3x), 3px (11x) | campos, botões | 3px (padrão) e 2px (compacto) e remover 1px. |
| M1 | Durações `.12s`, `.15s`, `.18s`, `.3s`; no mini painel `90ms linear`, `120ms ease 40ms`, `150ms` | transições | `fast` 120ms, `base` 180ms, `slow` 300ms; `.15s` → `base`. Nub: 90 → fast; 150 → base. |
| M2 | Animações em laço de 1,2 s (`thinking-dot`, `wr-line`) e de 1,5 s (`hit-*`) | l.257, l.302, l.717 | Dois tokens: loop 1,2 s e destaque 1,5 s. `prefers-reduced-motion` já é respeitado em dois lugares; generalizar. |
| Z1 | Camadas: 5, 20, 25, 29, 30, 40, 50 (`.overlay` e `.speaker-pop`), 60 (4 usos: toasts, menu de ações, visualizador, arrastar-e-soltar) | vários | Escala `--z-*` proposta. `.speaker-pop` (50) divide camada com o diálogo: conferir se é intencional. |
| O1 | Opacidades: .2 .25 .35 .4 .45 .5 .55 .6 .7 .8 .85 .88 .92 | vários | Três níveis: .45 (desabilitado), .6 (esmaecido), .85 (hover do primário). |

## Breakpoints

| # | Hoje | Sugestão |
|---|------|----------|
| B1 | Media queries de janela: 1000, 760, 620, 560, 520 (`max-width`) | 3: **1000 / 760 / 560**. 620 e 520 → 560 ou 760 (revisar caso a caso: l.759, l.765, l.791). |
| B2 | Container `detail`: 360, 380, 420, 440, 480, 520, 560, 580, 600, 620, 640, 760 (12 valores) | 5: **360 / 420 / 520 / 640 / 760**. 380→360, 440→420, 480→520, 560/580/600→520 ou 640, 620→640. É onde mais compensa consolidar: cada valor extra é um ajuste manual no zoom 1,44. |
| B3 | Container `recbar`: 330, 420, 500, 600; `mp`: 480, 620; `setcontent`: 560/760; `chat`: 400 | Alinhar a uma só família com B2 quando fizer sentido. |
| B4 | "Janela pequena" e "zoom 1,44" não são nomeados | Nomear: mínimo 420 px; zoom 1,44 numa janela de ~1180 px = ~820 px CSS (cai entre 760 e 1000). |

## Tema

| # | Hoje | Sugestão |
|---|------|----------|
| H1 | O app só usa `prefers-color-scheme`; não existe `data-theme` | `tokens.css` traz `[data-theme="dark"]`/`"light"` só para sites e documentos. Se o app um dia permitir tema manual, o mecanismo já está nos tokens. |
