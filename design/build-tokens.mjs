#!/usr/bin/env node
// Fonte única dos tokens do Rice. O app importa design/tokens.css (index.html, alert.html, nub.html); tests/design/tokens.test.ts vigia os literais.
// Gera design/tokens.css e design/tokens.json a partir da tabela abaixo:  node design/build-tokens.mjs
// Nomes: os que o app já usa em src/renderer/index.html foram mantidos (marcados `existing: true`); o resto é proposta.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** [grupo, nome, variável CSS, valor claro, valor escuro (opcional), existing, observação] */
const T = [];
const add = (group, name, css, light, dark, existing = false, note = '') => T.push({ group, name, css, light, dark, existing, note });

// ---- cores semânticas -------------------------------------------------------------------------------------------
add('color', 'bg', '--bg', '#fcfcfb', '#191919', true, 'fundo da janela e das áreas de leitura');
add('color', 'sidebar', '--sidebar', '#f5f5f3', '#1e1e1e', true, 'superfície secundária: barra lateral');
add('color', 'ink', '--ink', '#2a2a28', 'rgba(255,255,255,.88)', true, 'texto principal; também o fundo do botão primário e do toast');
add('color', 'muted', '--muted', '#6b6b66', 'rgba(255,255,255,.5)', true, 'texto secundário, ícones em repouso (contraste AA: >= 4,5:1 sobre --bg e --sidebar nos dois temas)');
add('color', 'faint', '--faint', '#b9b9b4', 'rgba(255,255,255,.25)', true, 'texto terciário DECORATIVO (dicas de atalho, placeholders); não passa AA, não usar em texto que informa');
add('color', 'hover', '--hover', 'rgba(42,42,40,.055)', 'rgba(255,255,255,.05)', true, 'superfície sutil: hover e cartões');
add('color', 'active', '--active', 'rgba(42,42,40,.09)', 'rgba(255,255,255,.09)', true, 'superfície ativa/selecionada');
add('color', 'field-bg', '--field-bg', 'rgba(42,42,40,.04)', 'rgba(255,255,255,.06)', true, 'fundo de campos e controles segmentados');
add('color', 'code', '--code', 'rgba(42,42,40,.06)', 'rgba(255,255,255,.07)', true, 'fundo de código inline');
add('color', 'line', '--line', 'rgba(42,42,40,.1)', 'rgba(255,255,255,.1)', true, 'borda e divisor (1 px)');
add('color', 'guide', '--guide', 'rgba(42,42,40,.2)', 'rgba(255,255,255,.2)', true, 'linha-guia mais forte (ramos, tracejados)');
add('color', 'accent', '--accent', '#4a6fd6', '#86a0f0', true, 'acento: foco, seleção, links');
add('color', 'ring', '--ring', 'rgba(74,111,214,.28)', 'rgba(134,160,240,.32)', true, 'anel de foco (accent translúcido)');
add('color', 'ok', '--ok', '#2e9e5b', '#4cc38a', true, 'sucesso');
add('color', 'warn', '--warn', '#c98a1b', '#e0a93b', true, 'aviso');
add('color', 'danger', '--danger', '#d6453f', '#ff7a73', true, 'perigo/erro (antes havia também --bad, fundido aqui; o escuro ganhou valor próprio)');
add('color', 'rec', '--rec', '#e5484d', '#ff6369', true, 'gravando (ponto e botão de gravação, "Parar")');
add('color', 'switch-on', '--switch-on', '#34C759', '#30D158', true, 'chave ligada (verde do sistema); PROPOSTA: avaliar fundir com --ok');
add('color', 'scrim-soft', '--scrim-soft', 'rgba(0,0,0,.28)', null, false, 'véu atrás de diálogos (hoje .overlay)');
add('color', 'scrim', '--scrim', 'rgba(0,0,0,.5)', null, false, 'véu do chat por cima (hoje .chat-scrim)');
add('color', 'scrim-strong', '--scrim-strong', 'rgba(0,0,0,.72)', null, false, 'visualizador de imagem (hoje .shot-viewer)');
add('color', 'on-accent', '--on-accent', '#ffffff', '#ffffff', false, 'texto/ícone sobre fundo sólido (knob da chave)');
add('color', 'on-scrim', '--on-scrim', 'rgba(255,255,255,.88)', null, false, 'texto sobre o véu escuro (visualizador de imagem), igual nos dois temas');
add('color', 'mask-on', '--mask-on', '#000', null, false, 'máscara de alfa (fade das listas): só o canal alfa importa');
add('color', 'nub-glass', '--nub-glass', 'rgba(28,28,28,.78)', null, false, 'mini painel (nub): sempre escuro, com blur 18 px');
add('color', 'nub-glass-strong', '--nub-glass-strong', 'rgba(28,28,28,.86)', null, false, 'painel de chat do mini painel');

// ---- tipografia -------------------------------------------------------------------------------------------------
add('font', 'family-sans', '--font-sans', '-apple-system, "SF Pro Text", ui-sans-serif, system-ui, sans-serif', null, false, 'no Windows cai em system-ui (Segoe UI)');
add('font', 'family-mono', '--font-mono', 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace', null, false, 'código e tempos (Menlo/SF Mono no macOS, Consolas no Windows)');
for (const [n, v, note] of [
  ['xs', '11px', 'legenda, atalhos, contadores'],
  ['sm', '12px', 'texto de apoio, chips, rótulos de controle'],
  ['md', '13px', 'UI padrão: botões, campos, menus, cartões'],
  ['lg', '14px', 'abas, linhas de lista, texto de destaque'],
  ['base', '15px', 'corpo da leitura (body)'],
  ['xl', '16px', 'título de diálogo'],
  ['2xl', '20px', 'título de seção grande / ícone grande'],
]) add('font', `size-${n}`, `--fs-${n}`, v, null, false, note);
add('font', 'size-title', '--title-size', 'clamp(22px, 5cqi, 30px)', null, true, 'título da página (fluido pela coluna)');
for (const [n, v] of [['regular', '400'], ['medium', '500'], ['semibold', '600']]) add('font', `weight-${n}`, `--fw-${n}`, v, null, false, n === 'semibold' ? 'títulos e botões de ênfase' : '');
for (const [n, v, note] of [
  ['tight', '1.3', 'títulos'],
  ['snug', '1.4', 'UI densa (campos, cartões)'],
  ['normal', '1.5', 'texto corrido curto'],
  ['loose', '1.6', 'leitura (body, transcrição)'],
]) add('font', `lh-${n}`, `--lh-${n}`, v, null, false, note);

// ---- espaçamento ------------------------------------------------------------------------------------------------
// Escala única de espaçamento (Fase 2: a escala compacta --gap-* foi fundida aqui; gap-1…6 = 2, 4, 8, 12, 16, 24 → space-05, 1, 2, 3, 4, 5).
for (const [n, v] of [['1', '4px'], ['2', '8px'], ['3', '12px'], ['4', '16px'], ['5', '24px'], ['6', '32px'], ['7', '48px'], ['8', '64px']]) add('space', `space-${n}`, `--space-${n}`, v, null, true, 'escala de respiro');
for (const [n, v, note] of [['05', '2px', 'meio passo'], ['15', '6px', 'a medida mais usada fora da escala (gap: 6px, 39x)'], ['25', '10px', 'padding/gap de 10 px (16x)']]) add('space', `space-${n}`, `--space-${n}`, v, null, false, `PROPOSTA: ${note}`);

// ---- forma ------------------------------------------------------------------------------------------------------
for (const [n, v, note] of [
  ['xs', '4px', 'kbd, código, checkbox'],
  ['sm', '6px', 'botão de ícone, item de menu/lista'],
  ['md', '8px', 'botão, campo, busca (o padrão)'],
  ['lg', '10px', 'cartões, caixas, segmentado'],
  ['xl', '12px', 'cartões grandes, caixa de pergunta, toast de consentimento'],
  ['2xl', '14px', 'diálogo'],
  ['pill', '999px', 'chips, toast, gravar'],
]) add('radius', n, `--radius-${n}`, v, null, false, note);

// ---- sombras ----------------------------------------------------------------------------------------------------
add('shadow', 'hairline', '--shadow-hairline', 'inset 0 0 0 1px var(--line)', null, false, 'contorno de 1 px sem ocupar espaço (botão "ghost"; 17x)');
add('shadow', 'focus', '--shadow-focus', '0 0 0 3px var(--ring)', null, false, 'anel de foco (11x); a variante de 2 px é sm');
add('shadow', 'focus-sm', '--shadow-focus-sm', '0 0 0 2px var(--ring)', null, false, '');
add('shadow', 'raise', '--shadow-raise', '0 1px 2px rgba(0,0,0,.2)', null, false, 'PROPOSTA: knob da chave (.3) e item selecionado do segmentado (.14) viram um só');
add('shadow', 'pop', '--shadow-pop', '0 8px 28px rgba(0,0,0,.18)', '0 0 0 1px var(--line), 0 8px 28px rgba(0,0,0,.28)', false, 'menus e popovers (no escuro ganha contorno)');
add('shadow', 'dialog', '--shadow-dialog', '0 12px 40px rgba(0,0,0,.25)', null, false, 'diálogo');
add('shadow', 'drawer', '--shadow-drawer', '-12px 0 32px rgba(0,0,0,.35)', null, false, 'chat lateral');

// ---- movimento --------------------------------------------------------------------------------------------------
add('motion', 'dur-fast', '--dur-fast', '120ms', null, false, 'hover, opacidade (hoje .12s)');
add('motion', 'dur-base', '--dur-base', '180ms', null, false, 'PROPOSTA: .15s e .18s viram um só');
add('motion', 'dur-slow', '--dur-slow', '300ms', null, false, 'largura de painéis');
add('motion', 'ease', '--ease', 'ease', null, false, 'padrão');
add('motion', 'ease-out', '--ease-out', 'ease-out', null, false, 'destaque de acerto (hit-fade, 1.5 s)');
add('motion', 'ease-loop', '--ease-loop', 'ease-in-out', null, false, 'animações em laço (pensando, linha de progresso, 1.2 s)');

// ---- camadas ----------------------------------------------------------------------------------------------------
for (const [n, v, note] of [
  ['raised', '5', 'botão flutuante "ir ao vivo"'],
  ['chrome', '20', 'ferramentas da janela'],
  ['handle', '25', 'alças de redimensionar'],
  ['scrim', '29', 'véu do chat'],
  ['drawer', '30', 'chat lateral'],
  ['popover', '40', 'popover de menu'],
  ['modal', '50', 'diálogos, popover de falante'],
  ['top', '60', 'toasts, menu de ações, visualizador, arrastar-e-soltar'],
]) add('z', n, `--z-${n}`, v, null, false, note);

// ---- tamanhos de controle e ícones ------------------------------------------------------------------------------
for (const [n, v, note] of [['sm', '24px', 'chips, ações compactas'], ['md', '28px', 'botão de ícone, controles de linha'], ['lg', '32px', 'botão padrão (.btn), campos de rodapé'], ['xl', '36px', 'abas do mini painel, linhas do mp']]) add('control', `h-${n}`, `--h-${n}`, v, null, false, note);
for (const [n, v, note] of [['xs', '10px', 'ícone de parar/gravar'], ['sm', '12px', 'caret, ícone em texto pequeno'], ['md', '14px', 'ícone dentro de botão/linha (o mais usado)'], ['lg', '16px', 'padrão do RiceIcons (grade 24, traço 1.5)'], ['xl', '20px', 'estados vazios'], ['2xl', '28px', 'ilustração de estado vazio']]) add('icon', `size-${n}`, `--icon-${n}`, v, null, false, note);
add('icon', 'stroke', '--icon-stroke', '1.5', null, false, 'traço de todos os ícones de linha');

// ---- layout / janela --------------------------------------------------------------------------------------------
add('layout', 'side-w', '--side-w', '232px', null, true, 'barra lateral');
add('layout', 'chat-w', '--chat-w', '320px', null, true, 'chat lateral');
add('layout', 'titlebar', '--titlebar', '48px', null, true, 'faixa do topo (centro = semáforos do macOS)');
add('layout', 'traffic', '--traffic', '92px', null, true, 'espaço dos semáforos');
add('layout', 'dialog-w', '--dialog-w', 'min(520px, 90vw)', null, false, 'diálogo padrão');
for (const [n, v, note] of [['xs', '.45', 'desabilitado'], ['sm', '.6', 'secundário esmaecido'], ['md', '.85', 'hover do primário/toast']]) add('opacity', n, `--op-${n}`, v, null, false, `PROPOSTA: ${note}`);

// ---- breakpoints (valores em px CSS; media/container queries não aceitam var(), então são só documentação) --------
const BP = {
  window: { note: 'largura da janela em px CSS (zoom 1,44 numa janela de ~1180 px ≈ 820 px CSS)', lg: 1000, md: 760, sm: 560, minimum: 420 },
  detail: { note: 'container "detail" (coluna central)', xs: 360, sm: 420, md: 520, lg: 640, xl: 760 },
  recbar: { note: 'container "recbar" (barra de gravação)', xs: 330, sm: 420, md: 500, lg: 600 },
};

// ---- saídas -----------------------------------------------------------------------------------------------------
const block = (rows, pick) => rows.map((r) => `  ${r.css}: ${pick(r)};`).join('\n');
const light = T.map((r) => r);
const dark = T.filter((r) => r.dark !== null && r.dark !== undefined && r.dark !== r.light);

let css = `/*
 * Rice — tokens de design. Importado por src/renderer/index.html, alert.html e nub.html.
 * Gerado por design/build-tokens.mjs — não edite à mão. Mesmos valores de design/tokens.json.
 * Nomes que o app já usa (src/renderer/index.html) foram mantidos; o resto é proposta (ver DESIGN.md e design/divergencias.md).
 * Tema: o app segue o do sistema (prefers-color-scheme). [data-theme] existe aqui só para sites/documentos que queiram forçar um tema.
 */
:root {
${block(light, (r) => r.light)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${dark.map((r) => `    ${r.css}: ${r.dark};`).join('\n')}
  }
}

:root[data-theme="dark"] {
${dark.map((r) => `  ${r.css}: ${r.dark};`).join('\n')}
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
}
`;
writeFileSync(join(here, 'tokens.css'), css);

// tokens COMPARTILHADOS com o site (o site gera os dele a partir daqui): cinzas/superfícies/texto/linha, acento/anel/foco, rec, danger/ok/warn, raios, pesos, durações/curvas, sombra pop, mono, traço de ícone
const SHARED = new Set(['--bg', '--sidebar', '--ink', '--muted', '--faint', '--hover', '--active', '--field-bg', '--code', '--line', '--guide', '--accent', '--ring', '--ok', '--warn', '--danger', '--rec', '--shadow-focus', '--shadow-focus-sm', '--shadow-pop', '--font-mono', '--fw-regular', '--fw-medium', '--fw-semibold', '--dur-fast', '--dur-base', '--dur-slow', '--ease', '--ease-out', '--ease-loop', '--icon-stroke', ...T.filter((r) => r.group === 'radius').map((r) => r.css)]);
const json = { $description: 'Tokens de design do Rice (importados pelo app). Mesmos valores de tokens.css. `existing: true` = já é variável CSS do app. `shared: true` = compartilhado com o site (o site gera os tokens dele a partir deste arquivo).', version: 1, breakpoints: BP, tokens: {} };
for (const r of T) {
  (json.tokens[r.group] ??= {})[r.name] = { css: r.css, value: r.light, ...(r.dark !== null && r.dark !== undefined && r.dark !== r.light ? { dark: r.dark } : {}), existing: r.existing, ...(SHARED.has(r.css) ? { shared: true } : {}), ...(r.note ? { note: r.note } : {}) };
}
writeFileSync(join(here, 'tokens.json'), JSON.stringify(json, null, 2) + '\n');
console.log(`ok: ${T.length} tokens (${T.filter((r) => r.existing).length} já existentes no app)`);
