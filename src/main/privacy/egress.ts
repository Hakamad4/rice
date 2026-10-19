import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toLocalIso } from '../../shared/naming';
import type { AiProvider, AiRunner, EgressContext, EgressKind } from '../ai/types';

/**
 * Registro local, por reunião, de cada vez que algo dela foi mandado para um provedor de IA. SÓ METADADOS: nunca o conteúdo.
 * Fica em `<reunião>/.rice-egress.jsonl`. Quem registra é o ponto central dos runners (`createRunnerFor`), não cada recurso.
 */
export const EGRESS_FILE = '.rice-egress.jsonl';

export type EgressVia = 'cli' | 'api' | 'local';
export type EgressRecord = {
  at: string;
  kind: EgressKind;
  provider: AiProvider;
  via: EgressVia;
  /** Quanto foi enviado: caracteres de texto (instruções + conteúdo) e número de imagens. */
  items: { text: number; images: number };
  ok: boolean;
  /** A busca na web estava ligada nesta chamada. */
  web?: true;
  /** Quantos dados pessoais foram ocultados antes do envio. */
  redacted?: number;
};

const API_PROVIDERS: readonly AiProvider[] = ['claude-api', 'openai-api', 'gemini-api'];
export const viaOf = (provider: AiProvider): EgressVia => (provider === 'local-model' ? 'local' : API_PROVIDERS.includes(provider) ? 'api' : 'cli');

const KINDS: readonly string[] = ['notes', 'chat', 'ideas', 'warroom', 'screenshot', 'memory', 'email-draft', 'translate', 'other'];

/** Marca as chamadas deste runner com o contexto (quando o código que chama não sabe de qual reunião vem). */
export const withEgressContext = (runner: Pick<AiRunner, 'run'>, ctx: EgressContext): AiRunner => ({ run: (options) => runner.run({ ...options, egress: options.egress ?? ctx }) });

export const newEgress = (rec: Omit<EgressRecord, 'at'>, at: Date = new Date()): EgressRecord => ({ at: toLocalIso(at), ...rec });

export async function appendEgress(dir: string, record: EgressRecord): Promise<void> {
  await appendFile(join(dir, EGRESS_FILE), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/** Lê o registro com tolerância: linha malformada ou de outro formato é ignorada. */
export async function readEgress(dir: string): Promise<EgressRecord[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, EGRESS_FILE), 'utf8');
  } catch {
    return [];
  }
  const out: EgressRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Partial<EgressRecord> & { items?: { text?: unknown; images?: unknown } };
      if (typeof o.at !== 'string' || typeof o.kind !== 'string' || !KINDS.includes(o.kind) || typeof o.provider !== 'string' || !['cli', 'api', 'local'].includes(String(o.via))) continue;
      out.push({
        at: o.at,
        kind: o.kind as EgressKind,
        provider: o.provider as AiProvider,
        via: o.via as EgressVia,
        items: { text: Number(o.items?.text) || 0, images: Number(o.items?.images) || 0 },
        ok: o.ok === true,
        ...(o.web ? { web: true as const } : {}),
        ...(typeof o.redacted === 'number' && o.redacted > 0 ? { redacted: o.redacted } : {}),
      });
    } catch {
      // linha malformada
    }
  }
  return out;
}

export type ReceiptRow = { id: string; label: string; value: string; /** true = algo desta reunião saiu do computador por esta linha */ sent: boolean };
export type Receipt = { summary: string; nothingLeft: boolean; rows: ReceiptRow[] };

type Tr = (key: string, vars?: Record<string, string | number>) => string;
type Meta = { consentNoticeCopiedAt?: string; micName?: string; micChanges?: Array<{ at: string; name: string }> };

const GROUPS: Array<{ id: string; kinds: EgressKind[] }> = [
  { id: 'notes', kinds: ['notes'] },
  { id: 'chat', kinds: ['chat'] },
  { id: 'ideas', kinds: ['ideas', 'warroom'] },
  { id: 'email', kinds: ['email-draft'] },
  { id: 'memory', kinds: ['memory'] },
  { id: 'translate', kinds: ['translate'] },
  { id: 'other', kinds: ['other'] },
];
const ALWAYS = new Set(['notes', 'chat', 'ideas']);

const clock = (iso: string): string => {
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1]! : iso;
};

/**
 * O que saiu deste computador, em linhas legíveis. `t`/`tn` vêm do chamador (idioma do app); `providerLabel` dá o nome com a forma
 * de acesso ("Claude (assinatura)"). Provedor local conta como "não saiu".
 */
export function buildReceipt(entries: readonly EgressRecord[], meta: Meta, t: Tr, tn: (key: string, n: number, vars?: Record<string, string | number>) => string, providerLabel: (p: AiProvider) => string): Receipt {
  const rows: ReceiptRow[] = [
    { id: 'audio', label: t('receipt.audio'), value: t('receipt.audio.value'), sent: false },
    { id: 'transcript', label: t('receipt.transcript'), value: t('receipt.transcript.value'), sent: false },
  ];
  // o microfone que foi capturado (nome do dispositivo; com trocas no meio, a sequência): o áudio em si nunca sai do computador
  if (meta.micName) {
    const names = (meta.micChanges ?? []).map((c) => c.name).filter((n, i, all) => i === 0 || n !== all[i - 1]);
    rows.push({ id: 'mic', label: t('receipt.mic'), value: names.length > 1 ? names.join(' → ') : meta.micName, sent: false });
  }
  for (const group of GROUPS) {
    const list = entries.filter((e) => group.kinds.includes(e.kind));
    if (list.length === 0 && !ALWAYS.has(group.id)) continue;
    const label = t(`receipt.kind.${group.id}`);
    if (list.length === 0) {
      rows.push({ id: group.id, label, value: t('receipt.none'), sent: false });
      continue;
    }
    const providers = [...new Set(list.map((e) => providerLabel(e.provider)))].join(', ');
    const out = list.filter((e) => e.via !== 'local');
    const last = list[list.length - 1]!;
    rows.push({
      id: group.id,
      label,
      value: `${providers} · ${tn(out.length > 0 ? 'receipt.sends' : 'receipt.runs', list.length)} · ${clock(last.at)}${out.length === 0 ? ` · ${t('receipt.stayed')}` : ''}`,
      sent: out.length > 0,
    });
  }
  const images = entries.filter((e) => e.kind === 'screenshot' && e.via !== 'local').reduce((n, e) => n + e.items.images, 0);
  rows.push({ id: 'screenshots', label: t('receipt.screenshots'), value: tn('receipt.screenshots.value', images), sent: images > 0 });
  const webCalls = entries.filter((e) => e.web && e.via !== 'local').length;
  rows.push({ id: 'web', label: t('receipt.web'), value: webCalls > 0 ? tn('receipt.web.used', webCalls) : t('receipt.web.none'), sent: webCalls > 0 });
  const redacted = entries.reduce((n, e) => n + (e.redacted ?? 0), 0);
  if (redacted > 0) rows.push({ id: 'redacted', label: t('receipt.redacted'), value: tn('receipt.redacted.value', redacted), sent: false });
  rows.push({ id: 'consent', label: t('receipt.consent'), value: meta.consentNoticeCopiedAt ? t('receipt.consent.copied', { time: clock(meta.consentNoticeCopiedAt) }) : t('receipt.consent.none'), sent: false });
  const nothingLeft = !rows.some((r) => r.sent);
  const to = [...new Set(entries.filter((e) => e.via !== 'local').map((e) => providerLabel(e.provider)))].join(', ');
  return { summary: nothingLeft ? t('receipt.summary.local') : t('receipt.summary.sent', { to }), nothingLeft, rows };
}

/** Texto do recibo para copiar/exportar (compliance): título, resumo e uma linha por item. */
export function receiptText(receipt: Receipt, title: string, heading: string): string {
  return [`${heading}`, title, '', receipt.summary, '', ...receipt.rows.map((r) => `- ${r.label}: ${r.value}`), ''].join('\n');
}
