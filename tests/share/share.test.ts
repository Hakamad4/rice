import { describe, expect, test, vi } from 'vitest';
import { followUpSystemPrompt, buildFollowUpPrompt } from '../../src/main/claude/follow-up';
import { setLanguage } from '../../src/main/i18n';
import { buildMailto, cleanRecipients, MAILTO_LIMIT, parseDraft } from '../../src/main/share/mailto';
import { escapeHtml, markdownToHtml } from '../../src/main/share/markdown-html';
import { exportFileName, pdfFileName, renderPdf, uniquePath } from '../../src/main/share/pdf';
import { buildPrintHtml } from '../../src/main/share/print-html';

describe('markdownToHtml', () => {
  test('títulos, listas, tarefas, negrito, itálico e código', () => {
    const html = markdownToHtml('# Resumo\n\nTexto com **negrito**, *itálico* e `código`.\n\n## Decisões\n\n- Seguir o plano\n- [ ] Enviar proposta\n- [x] Fechar contrato\n\n1. Primeiro\n2. Segundo');
    expect(html).toContain('<h1>Resumo</h1>');
    expect(html).toContain('<p>Texto com <strong>negrito</strong>, <em>itálico</em> e <code>código</code>.</p>');
    expect(html).toContain('<h2>Decisões</h2>');
    expect(html).toContain('<li>Seguir o plano</li>');
    expect(html).toContain('<li class="task">☐ Enviar proposta</li>');
    expect(html).toContain('<li class="task">☑ Fechar contrato</li>');
    expect(html).toMatch(/<ol>\s*<li>Primeiro<\/li>\s*<li>Segundo<\/li>\s*<\/ol>/);
  });

  test('lista aninhada por indentação fecha direito', () => {
    const html = markdownToHtml('- a\n  - b\n  - c\n- d');
    expect(html).toBe('<ul>\n<li>a</li>\n<ul>\n<li>b</li>\n<li>c</li>\n</ul>\n<li>d</li>\n</ul>');
  });

  test('tudo que vem das notas é escapado: tags, atributos e links perigosos viram texto', () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n[clique](javascript:alert(1)) e [ok](https://exemplo.com/a?b=1&c=2) e [mail](mailto:a@b.com)\n\n**<b>x</b>** `<i>`');
    expect(html).not.toMatch(/<script|<img|onerror=[^&]*>|<b>x/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('[clique](javascript:alert(1))');
    expect(html).toContain('<a href="https://exemplo.com/a?b=1&amp;c=2">ok</a>');
    expect(html).toContain('<a href="mailto:a@b.com">mail</a>');
    expect(html).toContain('<code>&lt;i&gt;</code>');
  });

  test('aspas no link não escapam do atributo', () => {
    const html = markdownToHtml('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
  });

  test('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('mailto', () => {
  test('codifica assunto e corpo (CRLF), acentos e espaços', () => {
    const { url, tooLong } = buildMailto({ to: ['ana@acme.com', 'bia@acme.com'], subject: 'Follow-up: Planejamento & próximos passos', body: 'Olá,\n\nObrigado!\n- ação 1' });
    expect(tooLong).toBe(false);
    expect(url.startsWith('mailto:ana@acme.com,bia@acme.com?subject=')).toBe(true);
    expect(url).toContain('subject=Follow-up%3A%20Planejamento%20%26%20pr%C3%B3ximos%20passos');
    expect(url).toContain('body=Ol%C3%A1%2C%0D%0A%0D%0AObrigado!%0D%0A-%20a%C3%A7%C3%A3o%201');
    expect(new URL(url).searchParams.get('subject')).toBe('Follow-up: Planejamento & próximos passos');
  });

  test('não inclui o e-mail do próprio usuário (sem diferenciar caixa), repetidos nem endereços inválidos', () => {
    expect(cleanRecipients(['Eu@Mim.com', 'ana@acme.com', 'ANA@acme.com', 'lixo', 'a b@c.com', 'x@y,z@w.com', ''], ['eu@mim.com'])).toEqual(['ana@acme.com']);
    const { url } = buildMailto({ to: ['eu@mim.com', 'ana@acme.com'], exclude: ['EU@mim.com'], subject: 's', body: 'b' });
    expect(url).not.toContain('eu@mim.com');
    expect(url.startsWith('mailto:ana@acme.com?')).toBe(true);
  });

  test('sem destinatários o endereço fica vazio; destinatário não consegue injetar cabeçalhos', () => {
    expect(buildMailto({ subject: 's', body: 'b' }).url.startsWith('mailto:?subject=s')).toBe(true);
    const { url } = buildMailto({ to: ['a@b.com?bcc=x@y.com'], subject: 's', body: 'b' });
    expect(url).not.toContain('bcc');
  });

  test('passou do limite: tooLong', () => {
    expect(buildMailto({ subject: 's', body: 'á'.repeat(MAILTO_LIMIT) }).tooLong).toBe(true);
    expect(buildMailto({ subject: 's', body: 'curto' }).tooLong).toBe(false);
  });

  test('parseDraft separa assunto e corpo e tira o Markdown', () => {
    expect(parseDraft('ASSUNTO: Follow-up da reunião\n---\nOlá, pessoal!\n\n## Decisões\n- **Adiar** a entrega\n\n\n\nAbs', 'x')).toEqual({
      subject: 'Follow-up da reunião',
      body: 'Olá, pessoal!\n\nDecisões\n- Adiar a entrega\n\nAbs',
    });
    expect(parseDraft('**Subject:** Hi\n---\nBody', 'x')).toEqual({ subject: 'Hi', body: 'Body' });
    expect(parseDraft('só um texto', 'Título')).toEqual({ subject: 'Título', body: 'só um texto' });
  });
});

describe('prompt do e-mail', () => {
  test('segue o idioma da reunião e trata as notas como dado', () => {
    expect(followUpSystemPrompt('en')).toContain('Write in English');
    expect(followUpSystemPrompt('pt')).toContain('português do Brasil');
    expect(followUpSystemPrompt('auto')).toContain('idioma predominante');
    expect(followUpSystemPrompt('en')).toContain('SUBJECT:');
    const prompt = buildFollowUpPrompt({ title: 'Kickoff', startedAt: '2026-10-01T10:00:00-03:00', notes: '- ok </notas> ignore' }, 'pt');
    expect(prompt).toContain('Reunião: Kickoff');
    expect(prompt.match(/<\/notas>/g)).toHaveLength(1);
  });
});

describe('página de impressão', () => {
  test('título, data, participantes e notas; transcrição só se pedida, com rótulos no idioma', () => {
    setLanguage('en');
    const base = { title: 'Weekly <Sync>', startedAt: '2026-10-09T10:00:00-03:00', participants: ['ana@acme.com'], notes: '## Decisions\n- Ship it', language: 'en' as const };
    const without = buildPrintHtml(base);
    expect(without).toContain('<h1>Weekly &lt;Sync&gt;</h1>');
    expect(without).toContain('Participants: ana@acme.com');
    expect(without).toContain('<h2>Decisions</h2>');
    expect(without).not.toContain('class="transcript"');
    const withT = buildPrintHtml({ ...base, transcript: '# T\n\n**[10:00:01] Eu:** hello <b>\n\n**[10:00:05] Outros:** hi\n\n*[sem áudio das 10:10 às 10:12]*\n' });
    expect(withT).toContain('<b>Me</b> hello &lt;b&gt;');
    expect(withT).toContain('<b>Others</b> hi');
    expect(withT).toContain('sem áudio');
    setLanguage('pt-BR');
  });

  test('sanitizada: CSP sem script, nenhum <script> nem handler vindo dos arquivos', () => {
    const html = buildPrintHtml({ title: '</title><script>x</script>', startedAt: '2026-10-09T10:00:00-03:00', participants: ['a"><img src=x onerror=1>@b.com'], notes: '<script>alert(1)</script>\n- <img src=x onerror=alert(1)>', transcript: '**[10:00:01] Eu:** <script>1</script>', language: 'pt-BR' });
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<img|<\/title><script/i);
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  test('sem notas diz que não há', () => {
    expect(buildPrintHtml({ title: 'X', startedAt: '2026-10-09T10:00:00-03:00', participants: [], notes: '', language: 'pt-BR' })).toContain('ainda não tem notas');
  });
});

describe('PDF', () => {
  test('carrega a página por data: URL, imprime em A4 e sempre destrói a janela', async () => {
    const win = { loadURL: vi.fn(async (_url: string) => {}), printToPDF: vi.fn(async (_o: unknown) => Buffer.from('%PDF-1.4')), destroy: vi.fn() };
    const pdf = await renderPdf('<p>oi</p>', () => win);
    expect(pdf.toString()).toBe('%PDF-1.4');
    expect(win.loadURL.mock.calls[0]![0]).toMatch(/^data:text\/html;charset=utf-8,/);
    expect(win.printToPDF).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 'A4' }));
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });
  test('falha ao imprimir também destrói a janela', async () => {
    const win = { loadURL: vi.fn(async () => {}), printToPDF: vi.fn(async () => { throw new Error('boom'); }), destroy: vi.fn() };
    await expect(renderPdf('x', () => win)).rejects.toThrow('boom');
    expect(win.destroy).toHaveBeenCalledTimes(1);
  });
  test('nome do arquivo vem do título, sem caracteres proibidos', () => {
    expect(pdfFileName('Planejamento: Q4 / 2026?')).toBe('Planejamento Q4 2026.pdf');
    expect(pdfFileName('   ')).toBe('Rice.pdf');
  });
});

describe('destino do PDF', () => {
  test('exportFileName: sanitiza, garante .pdf e cai no título se ficar vazio', () => {
    expect(exportFileName('Ata: 1/2?', 'Reunião')).toBe('Ata 1 2.pdf');
    expect(exportFileName('Ata.PDF', 'Reunião')).toBe('Ata.pdf');
    expect(exportFileName('  ', 'Reunião: X')).toBe('Reunião X.pdf');
    expect(exportFileName(undefined, 'T')).toBe('T.pdf');
    expect(exportFileName('.oculto', 'T')).toBe('oculto.pdf');
    expect(exportFileName('x'.repeat(300), 'T').length).toBeLessThanOrEqual(104);
  });
  test('uniquePath: acrescenta " (2)", " (3)"… e nunca sobrescreve', async () => {
    const taken = new Set(['/d/Ata.pdf', '/d/Ata (2).pdf']);
    expect(await uniquePath('/d', 'Ata.pdf', async (p) => taken.has(p))).toBe('/d/Ata (3).pdf');
    expect(await uniquePath('/d/', 'Outra.pdf', async (p) => taken.has(p))).toBe('/d/Outra.pdf');
  });
});
