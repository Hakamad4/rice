/** Acima disso o Mail nem sempre abre o rascunho: o app oferece só "Copiar". */
export const MAILTO_LIMIT = 8000;

const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

const encode = (text: string): string => encodeURIComponent(text.replace(/\r\n?|\n/g, '\r\n'));

/** Endereços válidos, sem repetir (sem diferenciar caixa) e sem os de `exclude` (o e-mail do próprio usuário). */
export function cleanRecipients(list: readonly string[], exclude: readonly string[] = []): string[] {
  const skip = new Set(exclude.map((e) => e.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const email = String(raw ?? '').trim();
    const key = email.toLowerCase();
    if (!EMAIL.test(email) || skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export type Mailto = { url: string; tooLong: boolean };

/** `mailto:` com destinatários, assunto e corpo codificados (quebras de linha em CRLF). `tooLong` = passou de `MAILTO_LIMIT`. */
export function buildMailto(input: { to?: readonly string[]; subject: string; body: string; exclude?: readonly string[] }): Mailto {
  const to = cleanRecipients(input.to ?? [], input.exclude).map((e) => encodeURIComponent(e).replace(/%40/g, '@')).join(',');
  const url = `mailto:${to}?subject=${encode(input.subject)}&body=${encode(input.body)}`;
  return { url, tooLong: url.length > MAILTO_LIMIT };
}

/** Separa a resposta da IA ("ASSUNTO:/SUBJECT: …", uma linha `---`, o corpo) em assunto e corpo, sem Markdown. */
export function parseDraft(raw: string, fallbackSubject: string): { subject: string; body: string } {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  const m = /^\s*(?:\*\*)?(?:subject|assunto)(?:\*\*)?\s*:\s*(?:\*\*)?(.+?)\s*$/im.exec(text);
  let subject = fallbackSubject;
  let body = text;
  if (m) {
    subject = m[1]!.replace(/\*\*/g, '').trim() || fallbackSubject;
    body = text.slice(m.index + m[0].length).replace(/^\s*-{3,}\s*$/m, '');
  }
  body = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { subject: subject.replace(/\s+/g, ' ').slice(0, 200), body };
}
