# Design do Rice

Guia do design do app (Electron, Mac e Windows). **O app usa `design/tokens.css`** (importado por `index.html`, `alert.html` e `nub.html`): cores, fontes, espaçamento, raios, sombras, durações, camadas e opacidades vêm de `var(--…)`. As divergências de `design/divergencias.md` foram aprovadas e aplicadas (Fase 2). `tests/design/tokens.test.ts` falha se aparecer cor hex/rgb escrita direto fora de `tokens.css` (exceção: logos de provedores de IA). English summary: [DESIGN.en.md](DESIGN.en.md).

Arquivos:

- `design/tokens.css` e `design/tokens.json`: os mesmos valores. Gerados por `node design/build-tokens.mjs` (edite a tabela dentro dele, nunca os gerados).
- `design/divergencias.md`: valores quase iguais que deveriam ser um só, com onde aparecem e a sugestão.
- Fonte real hoje: o `<style>` de `src/renderer/index.html` (janela principal), `alert.html` (alerta de reunião) e `nub.html` (mini painel).

## Princípios

1. **Local-first.** Nada sai da máquina sem o usuário saber. O visual comunica isso (selo "100% local", avisos de consentimento) e a interface nunca pede dado pessoal desnecessário. Telas, exemplos e capturas de tela usam dados fictícios.
2. **Leve.** Pouco peso, pouca animação, nenhuma dependência de interface. O app fica ocioso sem timers acordando o renderer (veja o relógio único de 1 s em `warroom.js`).
3. **Sem emoji. Só ícones de linha.** Nunca emoji na interface nem nos textos. Ícones: traço de 1,5, sem preenchimento (exceções: ponto de gravação e `square` de parar).
4. **Tudo traduzido via `t()`.** Todo texto visível vem de `src/renderer/locales/pt-BR.js` e `en.js`; nada de string solta no código. Mensagens do main também usam `t()`.
5. **Responsivo.** Precisa funcionar na **janela pequena (420 px)** e com **zoom 1,44** (uma janela de ~1180 px vira ~820 px CSS), sem rolagem horizontal, em tema claro e escuro.
6. **Claro e escuro.** Segue o sistema (`prefers-color-scheme`). Toda cor nova precisa de valor nos dois temas.
7. **Quieto.** Ênfase por peso e contraste, não por cor. O acento (azul) é para foco e seleção; vermelho só para erro e gravação.

## Tokens

Os valores abaixo estão em `design/tokens.json`.

### Cores semânticas

| Papel | Token | Claro | Escuro |
|---|---|---|---|
| Fundo | `--bg` (existente) | `#fcfcfb` | `#191919` |
| Superfície secundária | `--sidebar` (existente) | `#f5f5f3` | `#1e1e1e` |
| Superfície sutil / hover | `--hover` (existente) | 5,5% do texto | 5% branco |
| Superfície ativa | `--active` (existente) | 9% do texto | 9% branco |
| Fundo de campo | `--field-bg` (existente) | 4% do texto | 6% branco |
| Texto | `--ink` (existente) | `#2a2a28` | 88% branco |
| Texto secundário | `--muted` (existente) | `#8a8a85` | 45% branco |
| Texto terciário | `--faint` (existente) | `#b9b9b4` | 25% branco |
| Borda | `--line` (existente) | 10% do texto | 10% branco |
| Guia (borda forte) | `--guide` (existente) | 20% do texto | 20% branco |
| Acento | `--accent` (existente) | `#4a6fd6` | `#86a0f0` |
| Anel de foco | `--ring` (existente) | acento a 28% | acento a 32% |
| Sucesso | `--ok` (existente) | `#2e9e5b` | `#4cc38a` |
| Aviso | `--warn` (existente) | `#c98a1b` | `#e0a93b` |
| Perigo | `--danger` (`--bad` foi fundido; ganhou valor no escuro) | `#d6453f` | `#ff7a73` |
| Gravando | `--rec` (existente) | `#e5484d` | `#ff6369` |
| Chave ligada | `--switch-on` (verde do sistema, token próprio) | `#34C759` | `#30D158` |

O "texto" do claro é `rgb(42 42 40)`; as transparências acima são ele com alfa. Véus: `--scrim-soft` (.28), `--scrim` (.5), `--scrim-strong` (.72).

### Tipografia

- Família: `-apple-system, "SF Pro Text", ui-sans-serif, system-ui, sans-serif` (`--font-sans`); código: `ui-monospace, Menlo, monospace` (`--font-mono`). No Windows cai em `system-ui`.
- Tamanhos: `--fs-xs` 11 · `--fs-sm` 12 · `--fs-md` 13 (UI) · `--fs-lg` 14 · `--fs-base` 15 (corpo) · `--fs-xl` 16 · `--fs-2xl` 20 · `--title-size` `clamp(22px, 5cqi, 30px)`.
- Pesos: 400, 500, 600 (700 não entra na escala).
- Altura de linha: 1,3 (títulos), 1,4 (UI densa), 1,5, 1,6 (leitura; o `body` usa 1,6).

### Espaçamento

Escala única `--space-*`: 05 (2 px), 1 (4), 15 (6), 2 (8), 25 (10), 3 (12), 4 (16), 5 (24), 6 (32), 7 (48), 8 (64). A antiga escala compacta `--gap-1…6` foi fundida nela.

### Forma, sombra, movimento, camadas

- Raios: 4 · 6 · 8 (padrão) · 10 · 12 · 14 · pílula (`--radius-xs…2xl`, `--radius-pill`).
- Sombras: `--shadow-hairline` (contorno 1 px por dentro), `--shadow-focus` (anel 3 px), `--shadow-focus-sm` (2 px), `--shadow-raise`, `--shadow-pop` (menus), `--shadow-dialog`, `--shadow-drawer`.
- Movimento: `--dur-fast` 120 ms, `--dur-base` 180 ms, `--dur-slow` 300 ms; `ease` padrão. `prefers-reduced-motion` zera as durações.
- Camadas: 5, 20, 25, 29, 30, 40, 50, 60 (`--z-raised … --z-top`).
- Controles: alturas 24 / 28 / 32 / 36 (`--h-sm…xl`). Ícones: 10 / 12 / 14 / 16 / 20 / 28.

### Breakpoints

Em px CSS. O zoom reduz a largura efetiva: a 1,44, uma janela de 1180 px mede ~820 px CSS.

| Contexto | Valores propostos | Hoje |
|---|---|---|
| Janela (`@media`) | 1000 · 760 · 560 (mínimo de teste: 420) | 1000, 760, 620, 560, 520 |
| Coluna central (`@container detail`) | 360 · 420 · 520 · 640 · 760 | 12 valores diferentes |
| Barra de gravação (`@container recbar`) | 330 · 420 · 500 · 600 | idem |

Media e container queries não aceitam `var()`; os breakpoints existem só como valor documentado em `tokens.json` (`breakpoints`).

## Componentes que já existem

Onde estão no código (linhas de `src/renderer/index.html` salvo indicação; confira com busca, o arquivo muda).

| Componente | Estilo | Comportamento |
|---|---|---|
| Botão | `button` base (~l.70), `.btn` 32 px / raio 8 (~l.579); `.btn.ghost` (contorno `--line`), `.btn.primary` (fundo `--ink`, texto `--bg`) | `RiceDialog.button` (`dialog.js`) |
| Botão de ícone | `.icon-btn` 28 px, raio 6 (~l.57) | `icons.js` |
| Chave (switch) | `input[type=checkbox].switch` 34×20 (~l.583); compacta 28×16 no rodapé da war room | `warroom.js` (`switchInput`) |
| Campos | regra única para `input`, `textarea`, `select` (~l.73): `--field-bg`, borda `--line`, raio 8, anel `--ring` no foco | `RiceDialog.field` |
| Cartões | `.wr-card` (~l.314), `.live-card`, `.connect-card`, `.mem-card`, `.attach-card`; fundo `--hover`, raio 10 | `warroom.js`, `memory.js`, `attachments.js` |
| Abas | `.mt-tabs` / `.mt-tab` (~l.263): texto `--muted`, sublinhado no ativo | `renderer.js` |
| Controle segmentado | `.segmented` / `.seg-btn` (~l.587) | `language-settings.js` (`segmented`) |
| Chips | `.mic-chip`, `.shots-chip`, `.fu-chip`, `.chips` (24–28 px, pílula) | `mic-chip.js`, `ai-chip.js`, `chips.js` |
| Menus e seletores | `.menu-select-btn`, menus de ação (`.menu-popover.action-menu`, z 60) | `menu-select.js`, `action-menu.js`, `template-picker.js`, `sidebar-menu.js` |
| Diálogo | `.dialog` (~l.211): raio 14, `--shadow-dialog`, largura `min(520px, 90vw)` | `dialog.js` (`RiceDialog.open`), `retention-dialog.js` |
| Toast | `.toast` pílula `--ink` sobre `--bg` (~l.753); pilha `#toast-stack` | `toast-stack.js` (`RiceToastStack.notice`), `consent-toast.js` |
| Barra de gravação | `#rec-bar` (container `recbar`) | `renderer.js` |
| Mini painel (nub) | `nub.html` + `nub.js`: pílula de vidro escuro (blur 18 px) que expande ao passar o mouse; botões `.act` | janela própria, sempre escura |
| Alerta de reunião | `alert.html` + `alert.js`: cartão flutuante de 12 px de raio com barra de cor à esquerda | janela própria |
| Faixa de versão nova | `update-notice.js`, página de atualizações `update-page.js` | `settings.js` |
| Estado vazio | `.wr-empty` (ícone 18–28 px + frase curta) | `warroom.js` |

## Ícones

- Origem: `src/renderer/icons.js`, desenhados no projeto, sem dependências. Estilo Lucide/Feather. Grade 24×24, `stroke="currentColor"`, traço 1,5, pontas arredondadas, `fill="none"`. Criados com `createElementNS` (nunca `innerHTML`).
- Uso: `window.RiceIcons.icon('nome')` devolve um `<svg class="icon icon-nome">` de 16 px; o tamanho muda por CSS (`.icon { width; height }`). Seta de dropdown: `RiceIcons.caret()` (12 px, traço 1,5). Ícones atuais: 56 (arquivo `icons.js`, `NAMES`); há um teste em `tests/renderer/icons.test.ts`.
- Tamanhos: 12 em texto pequeno, 14 dentro de botões e linhas, 16 padrão, 20+ em estado vazio. Cor sempre `currentColor` (`--muted` em repouso, `--ink` no hover).
- Marcas de provedores de IA (`src/renderer/assets/providers/*.svg`) são identidade de terceiros, fora da escala. Veja o README da pasta.

## Tom de voz dos textos

- Direto e calmo, em frases curtas. Sem exclamação, sem emoji, sem "oops". Fala com o usuário por "você" (pt-BR) ou por imperativo neutro; em inglês, frases simples no presente.
- Diga o que aconteceu e o que fazer: "A IA demorou demais e o ciclo foi interrompido." Erro nunca culpa o usuário.
- Verbos de ação nos botões ("Gerar agora", "Parar", "Atualizar agora"); reticências só para processo em andamento ("Gerando ideias…", "Preparando…").
- Privacidade é dita sem alarme e sem jargão: o que fica na máquina, o que sai e para quem.
- Referências a pessoas usam pronome neutro (they/them em inglês) quando o pronome é desconhecido.
- Tudo nasce em `pt-BR.js` e `en.js` juntos; chaves em `area.nome` (`warroom.generating`).

## Como mudar o design

1. Edite a tabela de `design/build-tokens.mjs` e rode `node design/build-tokens.mjs` (gera `tokens.css` e `tokens.json`).
2. No CSS use só `var(--token)`; valores fora da escala precisam de comentário (ex.: `14px por nível` da árvore de pastas, que o JS usa).
3. Rode `npx vitest run`: o teste de tokens e os de CSS conferem o resultado (`tests/helpers/tokens.ts` troca os tokens numéricos pelos valores para os testes de medida).
4. Breakpoints não aceitam `var()`: use os valores de `tokens.json` (`breakpoints`): janela 1000/760/560, coluna `detail` 360/420/520/640/760.
