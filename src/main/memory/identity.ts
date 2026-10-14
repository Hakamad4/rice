import { fold } from '../search/fold';

/** Nome sem acento, minúsculo e com espaços simples: a chave de pessoa/empresa. */
export const normName = (s: string): string => fold(String(s ?? '')).replace(/[^\p{L}\p{N}@.]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Domínios de e-mail pessoal: não identificam empresa. */
export const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.com.br', 'hotmail.com', 'hotmail.com.br', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.com.br', 'ymail.com', 'proton.me', 'protonmail.com', 'pm.me', 'aol.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'zoho.com', 'gmx.com', 'fastmail.com',
]);

export function domainOf(email: string): string | null {
  const m = /^[^@\s]+@([^@\s]+)$/.exec(String(email ?? '').trim().toLowerCase());
  return m ? m[1]! : null;
}

/** Nome de empresa para mostrar: o que veio todo em minúsculas (do domínio do e-mail) ganha inicial maiúscula ("acme" → "Acme"). */
export function orgLabel(name: string): string {
  const n = name.trim();
  return n && n === n.toLowerCase() ? n.replace(/(^|[\s.-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase()) : n;
}

/** Entre as grafias da mesma empresa, a que a IA citou (com maiúscula) vale mais que a do domínio. */
export function pickOrgName(variants: readonly string[]): string {
  const cited = variants.find((v) => v !== v.toLowerCase());
  return cited ?? orgLabel(variants[0] ?? '');
}

/** Empresa pelo domínio do e-mail ("ana@acme.com.br" → "acme"); null para domínio pessoal ou o do próprio usuário. */
export function orgFromEmail(email: string, ownDomains: readonly string[] = []): string | null {
  const domain = domainOf(email);
  if (!domain || PERSONAL_DOMAINS.has(domain) || ownDomains.map((d) => d.toLowerCase()).includes(domain)) return null;
  const parts = domain.split('.');
  // acme.com.br → acme; mail.acme.com → acme; acme.io → acme
  const second = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ind']);
  const labels = parts.length >= 3 && second.has(parts[parts.length - 2]!) ? parts.slice(0, -2) : parts.slice(0, -1);
  return labels[labels.length - 1] ?? null;
}

/**
 * Plano B quando não se sabe o e-mail do usuário: um domínio que aparece em quase TODAS as reuniões com e-mails (muitas, para não
 * confundir com um cliente único) é o do próprio usuário. O normal é vir do participante `self` da agenda.
 */
export function inferOwnDomains(emailLists: ReadonlyArray<readonly string[]>): string[] {
  const lists = emailLists.filter((l) => l.length > 0);
  if (lists.length < 8) return [];
  const counts = new Map<string, number>();
  for (const list of lists) for (const d of new Set(list.map(domainOf).filter((d): d is string => d !== null && !PERSONAL_DOMAINS.has(d)))) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts].filter(([, n]) => n / lists.length >= 0.9).map(([d]) => d);
}

const ME = /^(eu|me|myself|i|eu mesmo|eu mesma|user|usuario)$/;
export const isMe = (who: string): boolean => ME.test(normName(who));
/** Como o usuário aparece nos fatos. */
export const SELF = 'Eu';

/** O nome (ou o início do e-mail) de uma pessoa casa com este e-mail? ("Ana Silva" × ana.silva@acme.com). */
export function nameMatchesEmail(name: string, email: string): boolean {
  const local = normName(String(email).split('@')[0] ?? '').replace(/[._-]+/g, ' ');
  const tokens = normName(name).split(' ').filter((t) => t.length >= 3);
  if (tokens.length === 0 || !local) return false;
  return tokens.every((t) => local.includes(t)) || (tokens.length === 1 && local.split(' ').includes(tokens[0]!));
}

/** Pessoas de uma reunião: nomes (participantes da agenda e falantes) e a empresa de cada um quando o e-mail ajuda. */
export type Person = { name: string; org?: string };

export function peopleOf(input: { names?: readonly string[]; emails?: readonly string[]; speakers?: Record<string, string>; ownDomains?: readonly string[] }): { people: Person[]; orgs: string[] } {
  const own = input.ownDomains ?? [];
  const emails = (input.emails ?? []).filter((e) => domainOf(e));
  const orgs = [...new Set(emails.map((e) => orgFromEmail(e, own)).filter((o): o is string => o !== null))];
  const names = [...(input.names ?? []), ...Object.values(input.speakers ?? {})].map((n) => String(n).trim()).filter(Boolean);
  const seen = new Set<string>();
  const people: Person[] = [];
  for (const name of names) {
    const key = normName(name);
    if (!key || seen.has(key) || isMe(name)) continue;
    seen.add(key);
    const email = emails.find((e) => nameMatchesEmail(name, e));
    const org = email ? orgFromEmail(email, own) : orgs.length === 1 ? orgs[0]! : null; // e-mail pessoal conhecido = sem empresa; sem e-mail, a única empresa da reunião
    people.push({ name, ...(org ? { org } : {}) });
  }
  // e-mails sem nome (o nome vem do início do e-mail): viram pessoa pelo local-part
  for (const email of emails) {
    if (people.some((p) => nameMatchesEmail(p.name, email))) continue;
    const local = String(email).split('@')[0]!.replace(/[._-]+/g, ' ').trim();
    const key = normName(local);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const org = orgFromEmail(email, own);
    people.push({ name: local.replace(/\b\p{L}/gu, (c) => c.toUpperCase()), ...(org ? { org } : {}) });
  }
  return { people, orgs };
}
