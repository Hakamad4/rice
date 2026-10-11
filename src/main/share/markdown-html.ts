/** Escapa texto para HTML (também serve para atributos entre aspas). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SAFE_LINK = /^(?:https?:\/\/|mailto:)[^\s"'<>]+$/i;

/** Negrito, itálico, código e links em texto JÁ ESCAPADO por partes: nada do texto original chega ao HTML sem passar por `escapeHtml`. */
function inline(raw: string): string {
  return raw
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return escapeHtml(part)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
          const url = href.replace(/&amp;/g, '&').replace(/&quot;|&#39;|&lt;|&gt;/g, '');
          return SAFE_LINK.test(url) ? `<a href="${escapeHtml(url)}">${label}</a>` : whole;
        })
        .replace(/\*\*(.+?)\*\*(?!\*)/g, '<strong>$1</strong>')
        .replace(/\*(?!\s)([^*]+?)\*/g, '<em>$1</em>');
    })
    .join('');
}

type OpenList = { tag: 'ul' | 'ol'; indent: number };

export type HtmlOptions = {
  /** Tarefas `- [ ]`/`- [x]` viram ☐/☑ no texto (colam bem em Slack, Gmail, Notion e Docs, que descartam `<input>`). */
  taskBoxes?: boolean;
};

/**
 * Markdown das notas → HTML simples (títulos, listas com um nível de aninhamento por indentação, tarefas, negrito, itálico, código, links http/mailto).
 * É o nosso conversor, sem biblioteca: tudo que vem do Markdown é escapado, então `<script>` nas notas vira texto.
 */
export function markdownToHtml(markdown: string, _options: HtmlOptions = {}): string {
  const out: string[] = [];
  const lists: OpenList[] = [];
  let para: string[] = [];

  const closeLists = (toIndent = -1) => {
    while (lists.length > 0 && lists[lists.length - 1]!.indent > toIndent) out.push(`</${lists.pop()!.tag}>`);
  };
  const flushPara = () => {
    if (para.length > 0) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      flushPara();
      closeLists();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line.trim());
    if (heading && !/^\s/.test(line)) {
      flushPara();
      closeLists();
      const level = Math.min(4, heading[1]!.length);
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const item = /^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const indent = item[1]!.replace(/\t/g, '  ').length;
      const tag = item[2] ? 'ul' : 'ol';
      closeLists(indent);
      const top = lists[lists.length - 1];
      if (!top || top.indent < indent) {
        lists.push({ tag, indent });
        out.push(`<${tag}>`);
      } else if (top.tag !== tag) {
        out.push(`</${lists.pop()!.tag}>`);
        lists.push({ tag, indent });
        out.push(`<${tag}>`);
      }
      const task = item[2] ? /^\[([ xX])\]\s+(.*)$/.exec(item[4]!) : null;
      out.push(task ? `<li class="task">${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2]!)}</li>` : `<li>${inline(item[4]!)}</li>`);
      continue;
    }
    closeLists();
    para.push(line.trim());
  }
  flushPara();
  closeLists();
  return out.join('\n');
}
