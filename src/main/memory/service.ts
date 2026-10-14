import { listMeetingDirs, readMeetingText, readMeta } from '../store/meeting-files';
import type { AiRunner } from '../ai/types';
import type { MeetingMeta } from '../../shared/types';
import { Backfill, extractMeeting, type BackfillProgress, type Lang } from './extract';
import { addManual, diffFromNotes, listFollowups, overdueMine, planNotifications, readNotifyState, sendToReminders, setDone, setDue, toggleTaskLine, writeNotifyState, type Filter, type Group, GROUPS } from './followups';
import { inferOwnDomains, isMe, normName, orgLabel, peopleOf, pickOrgName, type Person } from './identity';
import { buildBrief, liveBullets, memoryContextWithDirs, mentionedIn, type Brief, type BriefBullet } from './recall';
import { MemoryStore } from './store';
import { isFollowup, type Fact, FACT_KINDS } from './types';
import { parseDue } from './due';
import { writeNotes } from '../store/meeting-files';

/** O que o renderer recebe de um fato: sem e-mails (a memória nem os guarda) e só texto. */
export type FactView = Pick<Fact, 'id' | 'kind' | 'who' | 'org' | 'about' | 'text' | 'due' | 'status' | 'mine' | 'manual' | 'doneAt'> & { source: { dir: string; title: string; date: string }; doneBy?: { dir: string; title: string; date: string } | { manual: true } };

export const viewOf = (f: Fact): FactView => ({
  id: f.id, kind: f.kind, who: f.who, ...(f.org ? { org: orgLabel(f.org) } : {}), about: f.about, text: f.text, ...(f.due ? { due: f.due } : {}), status: f.status, mine: f.mine, ...(f.manual ? { manual: true as const } : {}),
  source: { dir: f.source.dir, title: f.source.title, date: f.source.date }, ...(f.doneBy ? { doneBy: f.doneBy } : {}), ...(f.doneAt ? { doneAt: f.doneAt } : {}),
});

export type CalendarEventLike = { id: string; title: string; start: string; attendeeNames?: string[]; attendeeEmails?: string[] };

export type MemoryServiceDeps = {
  root: () => Promise<string>;
  /** Modelo leve do provedor ativo. */
  runner: () => Pick<AiRunner, 'run'>;
  language: (meta?: MeetingMeta) => Promise<Lang>;
  enabled: () => boolean;
  notifyEnabled: () => boolean;
  events: () => CalendarEventLike[];
  /** Domínios do próprio usuário (do participante `self` da agenda). */
  ownDomains?: () => string[];
  /** Orçamento de caracteres do contexto (modelo local: depende do `num_ctx`); sem isso vale o padrão da nuvem. */
  budget?: () => Promise<number | undefined>;
  now?: () => Date;
  onProgress?: (p: BackfillProgress) => void;
  onChanged?: () => void;
};

export class MemoryService {
  private store: MemoryStore | null = null;
  private storeRoot: string | null = null;
  private backfill: Backfill | null = null;
  private extracting = new Set<string>();
  private ownCache: { at: number; domains: string[] } | null = null;

  constructor(private readonly deps: MemoryServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async memory(): Promise<MemoryStore> {
    const root = await this.deps.root();
    if (!this.store || this.storeRoot !== root) {
      this.store = new MemoryStore(root, () => this.now());
      this.storeRoot = root;
      this.backfill = null;
      this.ownCache = null;
    }
    await this.store.ready();
    return this.store;
  }

  /** O domínio do próprio usuário (a agenda não lista o dono): inferido das reuniões com e-mails, em cache por alguns minutos. */
  private async ownDomains(): Promise<string[]> {
    if (this.ownCache && Date.now() - this.ownCache.at < 10 * 60_000) return this.ownCache.domains;
    const lists: string[][] = this.deps.events().map((e) => e.attendeeEmails ?? []);
    try {
      const root = await this.deps.root();
      for (const dir of (await listMeetingDirs(root)).slice(-60)) {
        const m = await readMeta(dir).catch(() => null);
        if (m?.participantEmails?.length) lists.push(m.participantEmails);
      }
    } catch {
      // sem reuniões: só os eventos
    }
    const domains = [...new Set([...(this.deps.ownDomains?.() ?? []), ...inferOwnDomains(lists)])];
    this.ownCache = { at: Date.now(), domains };
    return domains;
  }

  /** Chamado quando as notas de uma reunião ficam prontas. Nunca lança: a memória não atrapalha as notas. */
  async onNotesReady(dir: string): Promise<void> {
    if (!this.deps.enabled() || this.extracting.has(dir)) return;
    this.extracting.add(dir);
    try {
      const store = await this.memory();
      await extractMeeting(dir, { store, runner: this.deps.runner(), language: (m) => this.deps.language(m), ownDomains: () => this.ownCache?.domains ?? [], now: () => this.now(), ...(this.deps.budget ? { maxChars: this.deps.budget } : {}) });
      this.deps.onChanged?.();
    } catch {
      // IA fora do ar etc.: a reunião fica sem extração e o backfill a pega depois
    } finally {
      this.extracting.delete(dir);
    }
  }

  async removeMeeting(dir: string): Promise<void> {
    const store = await this.memory();
    await store.removeMeeting(dir);
    this.deps.onChanged?.();
  }

  // ---- status e página Memória ----
  async status() {
    const store = await this.memory();
    const bf = await this.backfillFor();
    const facts = store.all();
    return {
      enabled: this.deps.enabled(),
      facts: facts.length,
      people: new Set(facts.filter((f) => !isMe(f.who)).map((f) => normName(f.who))).size,
      orgs: new Set(facts.flatMap((f) => (f.org ? [normName(f.org)] : []))).size,
      pendingMeetings: (await bf.pending()).length,
      backfill: bf.state,
      notify: this.deps.notifyEnabled(),
    };
  }

  private async backfillFor(): Promise<Backfill> {
    const store = await this.memory();
    this.backfill ??= new Backfill({ store, runner: this.deps.runner(), language: (m) => this.deps.language(m), root: () => this.deps.root(), ownDomains: () => this.ownCache?.domains ?? [], now: () => this.now(), ...(this.deps.budget ? { maxChars: this.deps.budget } : {}), onProgress: (p) => { this.deps.onProgress?.(p); this.deps.onChanged?.(); } });
    return this.backfill;
  }

  async startBackfill(): Promise<{ total: number }> {
    if (!this.deps.enabled()) return { total: 0 };
    await this.ownDomains();
    const bf = await this.backfillFor();
    const total = (await bf.pending()).length;
    void bf.start();
    return { total };
  }

  cancelBackfill(): void {
    this.backfill?.cancel();
  }

  /** Lista por pessoa e por empresa, com busca simples (nome, empresa, assunto ou texto). */
  async list(query: unknown) {
    const store = await this.memory();
    const q = normName(typeof query === 'string' ? query.slice(0, 80) : '');
    const match = (f: Fact) => !q || normName(`${f.who} ${f.org ?? ''} ${f.about} ${f.text}`).includes(q);
    const people = new Map<string, FactView[]>();
    const orgs = new Map<string, { names: string[]; facts: FactView[] }>(); // por nome normalizado: "acme" e "Acme" são a mesma empresa
    for (const f of store.all().filter(match).sort((a, b) => b.source.date.localeCompare(a.source.date))) {
      const v = viewOf(f);
      if (!isMe(f.who)) (people.get(f.who) ?? people.set(f.who, []).get(f.who)!).push(v); // "Eu" não é uma pessoa da lista: o que é meu aparece em Pendências e na empresa
      if (f.org) {
        const key = normName(f.org);
        const entry = orgs.get(key) ?? orgs.set(key, { names: [], facts: [] }).get(key)!;
        entry.names.push(f.org);
        entry.facts.push(v);
      }
    }
    const rows = (m: Map<string, FactView[]>) => [...m].map(([name, facts]) => ({ name, facts })).sort((a, b) => a.name.localeCompare(b.name));
    const orgRows = [...orgs.values()].map((e) => ({ name: pickOrgName(e.names), facts: e.facts })).sort((a, b) => a.name.localeCompare(b.name));
    return { people: rows(people), orgs: orgRows };
  }

  /** Editar texto, prazo ou tipo de um fato (o texto editado é preservado nas próximas extrações). */
  async update(id: unknown, patch: unknown): Promise<FactView | null> {
    const store = await this.memory();
    const f = typeof id === 'string' ? store.get(id) : undefined;
    const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
    if (!f) return null;
    let next: Fact = { ...f, updatedAt: this.now().toISOString() };
    if (typeof p.text === 'string') {
      const text = p.text.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (text.length < 2) return null;
      next = { ...next, text, edited: true };
    }
    if ('due' in p) {
      const due = p.due === null || p.due === '' ? null : parseDue(p.due, this.now());
      if (p.due !== null && p.due !== '' && !due) return null;
      const { due: _d, ...rest } = next;
      next = { ...rest, ...(due ? { due } : {}) };
    }
    if (FACT_KINDS.includes(p.kind as never)) next = { ...next, kind: p.kind as Fact['kind'], edited: true };
    await store.put(next);
    this.deps.onChanged?.();
    return viewOf(next);
  }

  async remove(id: unknown): Promise<boolean> {
    const store = await this.memory();
    if (typeof id !== 'string' || !store.get(id)) return false;
    await store.remove([id]);
    this.deps.onChanged?.();
    return true;
  }

  async forget(kind: unknown, name: unknown): Promise<number> {
    if ((kind !== 'person' && kind !== 'org') || typeof name !== 'string') return 0;
    const n = await (await this.memory()).forget(kind, name);
    this.deps.onChanged?.();
    return n;
  }

  async clear(): Promise<void> {
    await (await this.memory()).clear();
    this.deps.onChanged?.();
  }

  // ---- O que lembrar ----
  private peopleOfEvent(e: CalendarEventLike | undefined, meta?: MeetingMeta, own: string[] = []): { people: Person[]; orgs: string[] } {
    return peopleOf({ names: e?.attendeeNames ?? meta?.participants ?? [], emails: e?.attendeeEmails ?? meta?.participantEmails ?? [], ...(meta?.speakers ? { speakers: meta.speakers } : {}), ownDomains: own });
  }

  private async brief(key: string, title: string, who: { people: Person[]; orgs: string[] }, excludeDir?: string): Promise<{ bullets: BriefBullet[]; recent: Brief['recent']; openCount: number } | null> {
    if (!this.deps.enabled()) return null;
    const store = await this.memory();
    const root = await this.deps.root();
    const b = await buildBrief({ key, title, people: who.people, orgs: who.orgs, ...(excludeDir ? { excludeDir } : {}) }, { store, runner: this.deps.runner(), language: () => this.deps.language(), root, now: () => this.now(), ...(this.deps.budget ? { maxChars: this.deps.budget } : {}) });
    if (!b) return null;
    const bullets = liveBullets(store, b.bullets);
    return bullets.length === 0 ? null : { ...b, bullets };
  }

  /** Cartão da aba Notas: só para reuniões ligadas a um evento da agenda. */
  async briefForMeeting(dir: string) {
    const meta = await readMeta(dir);
    if (!meta.calendarEventId && !meta.participantEmails?.length) return null;
    const own = await this.ownDomains();
    const event = this.deps.events().find((e) => e.id === meta.calendarEventId);
    return this.brief(`meeting:${meta.calendarEventId ?? dir}`, event?.title ?? meta.title, this.peopleOfEvent(event, meta, own), dir);
  }

  /** Linha do Início: eventos que começam em até 15 min (e só se houver o que lembrar). */
  async briefForEvent(eventId: unknown) {
    const e = this.deps.events().find((x) => x.id === eventId);
    if (!e) return null;
    const own = await this.ownDomains();
    return this.brief(`meeting:${e.id}`, e.title, this.peopleOfEvent(e, undefined, own));
  }

  // ---- memória no chat ----
  /** Fatos relevantes para o chat da reunião e o global, dentro de um orçamento de contexto. */
  async chatContext(question: string, meta?: MeetingMeta, budget = 3500): Promise<{ text: string; dirs: string[] }> {
    const none = { text: '', dirs: [] as string[] };
    if (!this.deps.enabled()) return none;
    const store = await this.memory();
    if (store.size === 0) return none;
    const cap = await this.deps.budget?.();
    if (cap) budget = Math.min(budget, Math.floor(cap * 0.2)); // modelo local: a memória cabe numa fatia da janela
    const own = await this.ownDomains();
    const fromMeeting = meta ? peopleOf({ names: meta.participants ?? [], emails: meta.participantEmails ?? [], ...(meta.speakers ? { speakers: meta.speakers } : {}), ownDomains: own }) : { people: [], orgs: [] };
    const named = mentionedIn(store, question);
    const people = [...new Set([...fromMeeting.people.map((p) => p.name), ...named.people])];
    const orgs = [...new Set([...fromMeeting.orgs, ...named.orgs])];
    if (people.length === 0 && orgs.length === 0) return none;
    return memoryContextWithDirs(store, { people, orgs }, budget, this.now());
  }

  // ---- pendências ----
  async followups(filter: unknown) {
    const store = await this.memory();
    const f: Filter = filter === 'mine' || filter === 'others' ? filter : 'all';
    const now = this.now();
    const groups = listFollowups(store, f, now);
    return { groups: Object.fromEntries(GROUPS.map((g) => [g, groups[g].map(viewOf)])) as Record<Group, FactView[]>, overdueMine: overdueMine(store, now) };
  }

  async overdueCount(): Promise<number> {
    return overdueMine(await this.memory(), this.now());
  }

  async setDone(id: unknown, done: unknown): Promise<FactView | null> {
    if (typeof id !== 'string') return null;
    const r = await setDone(await this.memory(), id, done === true, this.now());
    if (r) this.deps.onChanged?.();
    return r ? viewOf(r) : null;
  }

  async setDue(id: unknown, due: unknown): Promise<FactView | null> {
    if (typeof id !== 'string') return null;
    const r = await setDue(await this.memory(), id, due, this.now());
    if (r) this.deps.onChanged?.();
    return r ? viewOf(r) : null;
  }

  async addFollowup(input: unknown, resolveMeeting: (dir: string) => Promise<{ title: string; date: string } | null>): Promise<FactView | null> {
    const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    let link: { dir: string; title: string; date: string } | undefined;
    if (typeof o.dir === 'string' && o.dir) {
      const info = await resolveMeeting(o.dir).catch(() => null); // o dir já passou por checkedDir: aqui só lê o título
      if (info) link = { dir: o.dir, ...info };
    }
    const f = await addManual(await this.memory(), { text: String(o.text ?? ''), due: o.due, ...(link ? link : {}), mine: o.mine !== false, ...(typeof o.who === 'string' ? { who: o.who } : {}) }, this.now());
    if (f) this.deps.onChanged?.();
    return f ? viewOf(f) : null;
  }

  /** O usuário marcou uma tarefa nas notas renderizadas: grava nas notas e reflete nas pendências daquela reunião. */
  async toggleNoteTask(dir: string, text: unknown, checked: unknown): Promise<boolean> {
    if (typeof text !== 'string') return false;
    const notes = await readMeetingText(dir, 'notes');
    const r = toggleTaskLine(notes, text, checked === true);
    if (!r.changed) return false;
    await writeNotes(dir, r.text);
    const store = await this.memory();
    for (const change of diffFromNotes(r.text, store.ofDir(dir))) await setDone(store, change.id, change.done, this.now(), { syncNotes: false });
    this.deps.onChanged?.();
    return true;
  }

  /** Aviso local (uma vez por dia, a partir das 9h). Devolve o que mostrar; quem chama notifica e chama `markNotified`. */
  async dueNotification(): Promise<{ ids: string[]; count: number; allToday: boolean; text: string } | null> {
    if (!this.deps.notifyEnabled() || !this.deps.enabled()) return null;
    const store = await this.memory();
    const root = await this.deps.root();
    const plan = planNotifications(store, await readNotifyState(root), this.now());
    return plan ? { ids: plan.ids, count: plan.ids.length, allToday: plan.allToday, text: plan.first.text } : null;
  }

  async markNotified(ids: string[]): Promise<void> {
    const root = await this.deps.root();
    const state = await readNotifyState(root);
    const today = this.now().toISOString().slice(0, 10);
    for (const id of ids) state.notified[id] = today;
    await writeNotifyState(root, state);
  }

  async toReminders(which: unknown): Promise<{ ok: boolean; count: number }> {
    const store = await this.memory();
    const open = store.all().filter((f) => isFollowup(f) && f.status === 'open' && f.mine);
    const items = (which === 'mine' ? open : open.filter((f) => f.id === which)).map((f) => ({ title: f.text, ...(f.due ? { due: f.due } : {}) }));
    return { ok: await sendToReminders(items), count: items.length };
  }
}

