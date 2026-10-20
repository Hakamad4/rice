// Ícones de linha minimalistas (estilo Lucide/Feather), desenhados aqui, sem dependências.
// 16×16, stroke="currentColor", 1.5, sem preenchimento, pontas arredondadas. Criados com createElementNS (nunca innerHTML).
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  // cada ícone: lista de elementos [tag, atributos] na grade 24×24
  const p = (d) => ['path', { d }];
  const circle = (cx, cy, r) => ['circle', { cx, cy, r }];
  // ponto sólido (fill currentColor, sem stroke): fica nítido e centrado no botão
  const dot = (cx, cy) => ['circle', { cx, cy, r: 1.5, fill: 'currentColor', stroke: 'none' }];
  const FOLDER = 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z';

  const SHAPES = {
    // logo do Rice (do usuário): tigela com arroz em meia-lua, sólido (fill currentColor, sem traço); grade 24×24 com 2 de margem
    languages: [p('m5 8 6 6'), p('m4 14 6-6 2-3'), p('M2 5h12'), p('M7 2h1'), p('m22 22-5-10-5 10'), p('M14 18h6')],
    lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], p('M8 11V8a4 4 0 0 1 8 0v3')],
    shield: [p('M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z')],
    'arrow-up-right': [p('M7 17 17 7'), p('M8 7h9v9')],
    'arrow-down': [p('M12 5v14'), p('m19 12-7 7-7-7')],
    square: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }]],
    'arrow-up': [p('M12 19V5'), p('m5 12 7-7 7 7')],
    rice: [
      ['path', { d: 'M267 462 C274 405 312 366 357 365 C371 326 408 299 451 315 C470 283 499 263 528 263 C558 263 587 283 606 315 C649 299 686 326 700 365 C745 366 783 405 790 462 Z', transform: 'translate(2 3.3) scale(.03273) translate(-223 -263)', fill: 'currentColor', stroke: 'none' }],
      ['path', { d: 'M223 490 H834 A305.5 305.5 0 0 1 223 490 Z', transform: 'translate(2 3.3) scale(.03273) translate(-223 -263)', fill: 'currentColor', stroke: 'none' }],
    ],
    terminal: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], p('m7 9 3 3-3 3'), p('M13 15h4')],
    pencil: [p('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'), p('m15 5 4 4')],
    folder: [p(FOLDER)],
    'folder-plus': [p(FOLDER), p('M12 10v6'), p('M9 13h6')],
    trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'), p('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'), p('M10 11v6'), p('M14 11v6')],
    pause: [['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }], ['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }]],
    play: [p('M6 3l14 9-14 9z')],
    'check-circle': [circle(12, 12, 9), p('m8.5 12.5 2.5 2.5 4.5-5')],
    camera: [p('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'), circle(12, 13, 3)],
    more: [dot(5, 12), dot(12, 12), dot(19, 12)],
    'chevron-right': [p('m9 18 6-6-6-6')],
    'chevron-down': [p('m6 9 6 6 6-6')],
    check: [p('M20 6 9 17l-5-5')],
    plug: [p('M12 22v-5'), p('M9 8V2'), p('M15 8V2'), p('M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z')],
    search: [circle(11, 11, 8), p('m21 21-4.3-4.3')],
    sidebar: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], p('M9 3v18')],
    settings: [
      circle(12, 12, 3),
      p('M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
    ],
    plus: [p('M5 12h14'), p('M12 5v14')],
    paperclip: [p('m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48')],
    image: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], circle(9, 9, 2), p('m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21')],
    file: [p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4')],
    'file-text': [p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'), p('M10 9H8'), p('M16 13H8'), p('M16 17H8')],
    record: [circle(12, 12, 9), circle(12, 12, 4)],
    // teclado: corpo com cantos arredondados, teclas como pontos e a barra de espaço
    keyboard: [p('M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'), p('M6 9h.01'), p('M10 9h.01'), p('M14 9h.01'), p('M18 9h.01'), p('M8 13h.01'), p('M12 13h.01'), p('M16 13h.01'), p('M7 16h10')],
    mic: [p('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z'), p('M19 10v2a7 7 0 0 1-14 0v-2'), p('M12 19v3')],
    link: [p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'), p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')],
    calendar: [p('M8 2v4'), p('M16 2v4'), p('M3 10h18'), p('M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z')],
    video: [p('m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11'), p('M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z')],
    history: [p('M3 12a9 9 0 1 0 3-6.7'), p('M3 4v5h5'), p('M12 7v5l3 2')],
    radar: [circle(12, 12, 10), circle(12, 12, 6), circle(12, 12, 2)],
    pin: [p('M12 17v5'), p('M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z')],
    globe: [circle(12, 12, 10), p('M2 12h20'), p('M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z')],
    move: [p('M12 2v20'), p('m15 19-3 3-3-3'), p('m19 9 3 3-3 3'), p('M2 12h20'), p('m5 9-3 3 3 3'), p('m9 5 3-3 3 3')],
    x: [p('M18 6 6 18'), p('m6 6 12 12')],
    users: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), circle(9, 7, 4), p('M22 21v-2a4 4 0 0 0-3-3.87'), p('M16 3.13a4 4 0 0 1 0 7.75')],
    sun: [circle(12, 12, 4), p('M12 2v2'), p('M12 20v2'), p('m4.93 4.93 1.41 1.41'), p('m17.66 17.66 1.41 1.41'), p('M2 12h2'), p('M20 12h2'), p('m6.34 17.66-1.41 1.41'), p('m19.07 4.93-1.41 1.41')],
    'user-check': [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), circle(9, 7, 4), p('m16 11 2 2 4-4')],
    briefcase: [['rect', { x: 2, y: 7, width: 20, height: 14, rx: 2 }], p('M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16')],
    lightbulb: [p('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'), p('M9 18h6'), p('M10 22h4')],
    plug: [p('M12 22v-5'), p('M9 8V2'), p('M15 8V2'), p('M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z')],
    info: [circle(12, 12, 10), p('M12 16v-4'), p('M12 8h.01')],
    home: [p('m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'), p('M9 22V12h6v10')],
    sparkles: [p('m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z'), p('M5 3v4'), p('M3 5h4'), p('M19 17v4'), p('M17 19h4')],
    copy: [['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }], p('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')],
    mail: [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], p('m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7')],
    share: [p('M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'), p('m16 6-4-4-4 4'), p('M12 2v13')],
    download: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('m7 10 5 5 5-5'), p('M12 15V3')],
    'message-circle': [p('M7.9 20A9 9 0 1 0 4 16.1L2 22Z')],
    'help-circle': [circle(12, 12, 10), p('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), p('M12 17h.01')],
  };

  const NAMES = Object.keys(SHAPES);

  /** Seta dos dropdowns: chevron largo e legível, 12×12, no mesmo traço de 1.5. Mesmo ícone em todos os chips/seletores. */
  function caret() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'icon caret');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M3 4.5 L6 7.5 L9 4.5');
    svg.append(path);
    return svg;
  }

  /** SVG 16×16 do ícone `name` (herda a cor do texto: currentColor). Nome desconhecido devolve um SVG vazio. */
  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', `icon icon-${name}`);
    for (const [tag, attrs] of SHAPES[name] || []) {
      const node = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      svg.append(node);
    }
    return svg;
  }

  /** Preenche os `[data-icon="nome"]` do HTML estático com o ícone. */
  function apply(root) {
    for (const node of (root || document).querySelectorAll('[data-icon]')) node.replaceChildren(icon(node.getAttribute('data-icon')));
  }

  window.RiceIcons = { icon, caret, apply, NAMES };
})();
