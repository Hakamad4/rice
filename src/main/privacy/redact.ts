/**
 * Ocultar dados pessoais ANTES de enviar texto para uma IA na nuvem. Detector local (regex + validação): CPF, CNPJ, cartão (Luhn),
 * e-mail, telefone BR/internacional, RG (melhor esforço, com a palavra "RG" perto) e CEP. Cada valor vira `[CPF 1]`, `[EMAIL 2]`…
 * (o mesmo valor, o mesmo marcador) e a resposta da IA é restaurada localmente. O mapa vive só na memória de UMA chamada: nunca é gravado.
 */
export type PiiType = 'CPF' | 'CNPJ' | 'CARD' | 'EMAIL' | 'PHONE' | 'RG' | 'ZIP';

const digits = (s: string): string => s.replace(/\D/g, '');
const allSame = (d: string): boolean => /^(\d)\1+$/.test(d);

export function validCpf(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 11 || allSame(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(d[len])) return false;
  }
  return true;
}

export function validCnpj(raw: string): boolean {
  const d = digits(raw);
  if (d.length !== 14 || allSame(d)) return false;
  const calc = (len: number): number => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function luhn(raw: string): boolean {
  const d = digits(raw);
  if (d.length < 13 || d.length > 19 || allSame(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

type Detector = { type: PiiType; re: RegExp; /** índice do grupo com o valor (padrão: 0) */ group?: number; ok?: (value: string, text: string, start: number) => boolean };

const YEAR_LIKE = /^(19|20)\d{2}$/;
/** "2024-2025" (intervalo de anos) e afins não são telefone. */
const yearRange = (v: string): boolean => {
  const m = /^(\d{4})-(\d{4})$/.exec(v);
  return Boolean(m && YEAR_LIKE.test(m[1]!) && YEAR_LIKE.test(m[2]!));
};
const NOT_AFTER = '(?<![\\d/.,-])'; // não começa no meio de outro número, data (12/03) ou valor (1.234)
const NOT_BEFORE = '(?![\\d/]|[.,]\\d)';

/** Em ordem de prioridade: o que vem antes "ganha" um trecho que mais de um detector reconheceria. */
const DETECTORS: Detector[] = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { type: 'CNPJ', re: new RegExp(`${NOT_AFTER}(?:\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2}|\\d{14})${NOT_BEFORE}`, 'g'), ok: (v) => validCnpj(v) },
  { type: 'CPF', re: new RegExp(`${NOT_AFTER}(?:\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|\\d{11})${NOT_BEFORE}`, 'g'), ok: (v) => validCpf(v) },
  { type: 'CARD', re: new RegExp(`${NOT_AFTER}\\d{4}(?:[ -]?\\d{4}){2,3}(?:[ -]?\\d{1,3})?${NOT_BEFORE}`, 'g'), ok: (v) => luhn(v) },
  // RG: só com a palavra "RG" (ou "identidade") logo antes; o número em si é o valor
  { type: 'RG', re: /\b(?:RG|R\.G\.|identidade)\s*(?:n[ºo°.]*\s*)?[:\-]?\s*(\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx])\b/gi, group: 1 },
  // CEP: 12345-678; sem hífen só com a palavra "CEP" antes
  { type: 'ZIP', re: new RegExp(`${NOT_AFTER}\\d{5}-\\d{3}${NOT_BEFORE}`, 'g') },
  { type: 'ZIP', re: /\bCEP\s*[:\-]?\s*(\d{8})\b/gi, group: 1 },
  // telefone: sempre com algum formato (parênteses, + ou separadores); número solto de 10-11 dígitos NÃO é telefone (pode ser pedido)
  { type: 'PHONE', re: new RegExp(`${NOT_AFTER}\\+\\d{1,3}[\\s.-]?\\(?\\d{1,4}\\)?(?:[\\s.-]?\\d{2,5}){2,4}${NOT_BEFORE}`, 'g'), ok: (v) => digits(v).length >= 9 && digits(v).length <= 15 },
  { type: 'PHONE', re: new RegExp(`${NOT_AFTER}\\(\\d{2,3}\\)\\s?9?\\d{3,4}[\\s.-]?\\d{4}${NOT_BEFORE}`, 'g') },
  { type: 'PHONE', re: new RegExp(`${NOT_AFTER}\\d{2}[\\s.-]9?\\d{4}[\\s.-]\\d{4}${NOT_BEFORE}`, 'g') },
  { type: 'PHONE', re: new RegExp(`${NOT_AFTER}\\d{3}[\\s.-]\\d{3}[\\s.-]\\d{4}${NOT_BEFORE}`, 'g') },
  { type: 'PHONE', re: new RegExp(`${NOT_AFTER}9?\\d{4}-\\d{4}${NOT_BEFORE}`, 'g'), ok: (v) => !yearRange(v) },
];

type Hit = { start: number; end: number; type: PiiType; value: string };

/** Todos os trechos sensíveis do texto, sem sobreposição (o detector de maior prioridade ganha). */
export function findPii(text: string): Hit[] {
  const taken: Hit[] = [];
  const overlaps = (a: number, b: number) => taken.some((h) => a < h.end && b > h.start);
  for (const d of DETECTORS) {
    for (const m of text.matchAll(d.re)) {
      const value = d.group ? m[d.group] : m[0];
      if (!value) continue;
      const start = d.group ? m.index! + m[0].lastIndexOf(value) : m.index!;
      const end = start + value.length;
      if (d.ok && !d.ok(value, text, start)) continue;
      if (overlaps(start, end)) continue;
      taken.push({ start, end, type: d.type, value });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

const PLACEHOLDER = /\[(CPF|CNPJ|CARD|EMAIL|PHONE|RG|ZIP) (\d{1,4})\]/gi;
/** O começo de um marcador que ainda pode estar chegando em pedaços: "[", "[CP", "[CPF 1". */
const PARTIAL_TAIL = /\[(?:[A-Za-z]{0,5}(?: \d{0,4})?)?$/;

/** Chave de igualdade do valor: dígitos para documentos e telefones; minúsculas para e-mail. */
const keyOf = (type: PiiType, value: string): string => `${type}:${type === 'EMAIL' ? value.toLowerCase() : digits(value)}`;

export type Redactor = {
  /** Troca os dados pessoais por marcadores. */
  redact(text: string): string;
  /** Devolve os valores originais no lugar dos marcadores (marcador desconhecido fica como está). */
  restore(text: string): string;
  /** Restaura uma resposta que chega em pedaços (um marcador cortado ao meio espera o próximo pedaço). */
  stream(): { feed(chunk: string): string; flush(): string };
  /** Quantos trechos foram ocultados (com repetição). */
  count(): number;
};

export function createRedactor(): Redactor {
  const byKey = new Map<string, string>(); // chave do valor -> marcador
  const original = new Map<string, string>(); // marcador (maiúsculo) -> como o valor apareceu primeiro
  const counters = new Map<PiiType, number>();
  let replaced = 0;

  const redact = (text: string): string => {
    const hits = findPii(text);
    if (hits.length === 0) return text;
    let out = '';
    let at = 0;
    for (const h of hits) {
      const key = keyOf(h.type, h.value);
      let tag = byKey.get(key);
      if (!tag) {
        const n = (counters.get(h.type) ?? 0) + 1;
        counters.set(h.type, n);
        tag = `[${h.type} ${n}]`;
        byKey.set(key, tag);
        original.set(tag.toUpperCase(), h.value);
      }
      out += text.slice(at, h.start) + tag;
      at = h.end;
      replaced++;
    }
    return out + text.slice(at);
  };

  const restore = (text: string): string => text.replace(PLACEHOLDER, (m, type: string, n: string) => original.get(`[${type.toUpperCase()} ${Number(n)}]`) ?? m);

  const stream = () => {
    let held = '';
    return {
      feed(chunk: string): string {
        const text = held + chunk;
        const tail = PARTIAL_TAIL.exec(text);
        held = tail ? tail[0] : '';
        return restore(tail ? text.slice(0, tail.index) : text);
      },
      flush(): string {
        const rest = held;
        held = '';
        return restore(rest);
      },
    };
  };

  return { redact, restore, stream, count: () => replaced };
}
