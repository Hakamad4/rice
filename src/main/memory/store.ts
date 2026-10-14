import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isFollowup, type Fact } from './types';
import { normName } from './identity';

/** `<raiz>/.rice/memory.jsonl`: um registro por linha; o último de cada id vale. Só local. */
export const memoryDir = (root: string) => join(root, '.rice');
export const memoryFile = (root: string) => join(memoryDir(root), 'memory.jsonl');

type Record =
  | { op: 'put'; fact: Fact }
  | { op: 'del'; id: string }
  | { op: 'extracted'; dir: string; at: string };

const isFact = (x: unknown): x is Fact => {
  const o = x as Partial<Fact> | null;
  return typeof o === 'object' && o !== null && typeof o.id === 'string' && typeof o.text === 'string' && typeof o.who === 'string' && typeof o.kind === 'string' && typeof o.source === 'object' && o.source !== null && typeof o.source.dir === 'string';
};

/**
 * Fatos em memória com índice por pessoa, empresa e reunião, atualizado a cada escrita (sem reler o arquivo). O arquivo só cresce
 * por acréscimo e é compactado quando tem muito lixo.
 */
export class MemoryStore {
  private facts = new Map<string, Fact>();
  private byPerson = new Map<string, Set<string>>();
  private byOrg = new Map<string, Set<string>>();
  private byDir = new Map<string, Set<string>>();
  private extracted = new Map<string, string>();
  private lines = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private loaded: Promise<void> | null = null;
  /** Muda a cada escrita (cache dos resumos). */
  version = 0;

  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {}

  /** Carrega o arquivo uma vez (tolerante: linha quebrada é ignorada). */
  ready(): Promise<void> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  private async load(): Promise<void> {
    let text = '';
    try {
      text = await readFile(memoryFile(this.root), 'utf8');
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      this.lines++;
      try {
        const rec = JSON.parse(line) as Record;
        if (rec.op === 'put' && isFact(rec.fact)) this.apply(rec.fact);
        else if (rec.op === 'del' && typeof rec.id === 'string') this.drop(rec.id);
        else if (rec.op === 'extracted' && typeof rec.dir === 'string') this.extracted.set(rec.dir, String(rec.at ?? ''));
      } catch {
        // linha quebrada (queda no meio da escrita): ignora
      }
    }
    if (this.lines > 200 && this.lines > 3 * (this.facts.size + this.extracted.size)) await this.compact();
  }

  private index(map: Map<string, Set<string>>, key: string, id: string): void {
    if (!key) return;
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(id);
  }

  private unindex(map: Map<string, Set<string>>, key: string, id: string): void {
    const set = map.get(key);
    set?.delete(id);
    if (set && set.size === 0) map.delete(key);
  }

  private apply(fact: Fact): void {
    this.drop(fact.id);
    this.facts.set(fact.id, fact);
    this.index(this.byPerson, normName(fact.who), fact.id);
    if (fact.org) this.index(this.byOrg, normName(fact.org), fact.id);
    this.index(this.byDir, fact.source.dir, fact.id);
    this.version++;
  }

  private drop(id: string): void {
    const old = this.facts.get(id);
    if (!old) return;
    this.facts.delete(id);
    this.unindex(this.byPerson, normName(old.who), id);
    if (old.org) this.unindex(this.byOrg, normName(old.org), id);
    this.unindex(this.byDir, old.source.dir, id);
    this.version++;
  }

  private write(records: Record[]): Promise<void> {
    const payload = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    this.lines += records.length;
    const run = this.chain.catch(() => undefined).then(async () => {
      await mkdir(memoryDir(this.root), { recursive: true, mode: 0o700 });
      await appendFile(memoryFile(this.root), payload, { mode: 0o600 });
    });
    this.chain = run;
    return run;
  }

  /** Reescreve o arquivo só com o que vale. */
  private async compact(): Promise<void> {
    const records: Record[] = [...[...this.facts.values()].map((fact): Record => ({ op: 'put', fact })), ...[...this.extracted].map(([dir, at]): Record => ({ op: 'extracted', dir, at }))];
    const tmp = `${memoryFile(this.root)}.${process.pid}.tmp`;
    await mkdir(memoryDir(this.root), { recursive: true, mode: 0o700 });
    await writeFile(tmp, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), { mode: 0o600 });
    await rename(tmp, memoryFile(this.root));
    this.lines = records.length;
  }

  newId(): string {
    return randomUUID();
  }

  // ---- leitura ----
  get size(): number {
    return this.facts.size;
  }
  all(): Fact[] {
    return [...this.facts.values()];
  }
  get(id: string): Fact | undefined {
    return this.facts.get(id);
  }
  ofDir(dir: string): Fact[] {
    return [...(this.byDir.get(dir) ?? [])].map((id) => this.facts.get(id)!).filter(Boolean);
  }
  ofPerson(name: string): Fact[] {
    return [...(this.byPerson.get(normName(name)) ?? [])].map((id) => this.facts.get(id)!).filter(Boolean);
  }
  ofOrg(name: string): Fact[] {
    return [...(this.byOrg.get(normName(name)) ?? [])].map((id) => this.facts.get(id)!).filter(Boolean);
  }
  isExtracted(dir: string): boolean {
    return this.extracted.has(dir);
  }
  extractedCount(): number {
    return this.extracted.size;
  }
  people(): string[] {
    return [...new Set(this.all().map((f) => f.who))];
  }

  /** Pendências abertas (compromisso/pedido) destas pessoas e empresas, as mais recentes primeiro, no máximo `limit`. */
  openFor(people: readonly string[], orgs: readonly string[], limit = 30): Fact[] {
    const ids = new Set<string>();
    for (const p of people) for (const f of this.ofPerson(p)) ids.add(f.id);
    for (const o of orgs) for (const f of this.ofOrg(o)) ids.add(f.id);
    return [...ids].map((id) => this.facts.get(id)!).filter((f) => f.status === 'open' && isFollowup(f)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }

  // ---- escrita ----
  async put(fact: Fact): Promise<void> {
    await this.ready();
    this.apply(fact);
    await this.write([{ op: 'put', fact }]);
  }

  async putMany(facts: Fact[]): Promise<void> {
    await this.ready();
    if (facts.length === 0) return;
    for (const f of facts) this.apply(f);
    await this.write(facts.map((fact) => ({ op: 'put', fact })));
  }

  async remove(ids: string[]): Promise<void> {
    await this.ready();
    const present = ids.filter((id) => this.facts.has(id));
    if (present.length === 0) return;
    for (const id of present) this.drop(id);
    await this.write(present.map((id) => ({ op: 'del', id })));
  }

  async markExtracted(dir: string): Promise<void> {
    await this.ready();
    const at = this.now().toISOString();
    this.extracted.set(dir, at);
    await this.write([{ op: 'extracted', dir, at }]);
  }

  /** Apagar uma reunião: some com os fatos dela (e com o "já extraída"). Pendências que ela fechou voltam a abertas. */
  async removeMeeting(dir: string): Promise<void> {
    await this.ready();
    const reopened: Fact[] = [];
    for (const f of this.facts.values()) {
      if (f.status === 'done' && f.doneBy && 'dir' in f.doneBy && f.doneBy.dir === dir && f.source.dir !== dir) {
        const { doneBy: _b, doneAt: _a, ...rest } = f;
        reopened.push({ ...rest, status: 'open', updatedAt: this.now().toISOString() });
      }
    }
    await this.remove(this.ofDir(dir).map((f) => f.id));
    await this.putMany(reopened);
    if (this.extracted.delete(dir)) await this.compactSoon();
  }

  /** Esquecer uma pessoa ou empresa. */
  async forget(kind: 'person' | 'org', name: string): Promise<number> {
    await this.ready();
    const list = kind === 'person' ? this.ofPerson(name) : this.ofOrg(name);
    await this.remove(list.map((f) => f.id));
    return list.length;
  }

  async clear(): Promise<void> {
    await this.ready();
    this.facts.clear();
    this.byPerson.clear();
    this.byOrg.clear();
    this.byDir.clear();
    this.extracted.clear();
    this.version++;
    await this.compact();
  }

  private compactSoon(): Promise<void> {
    const run = this.chain.catch(() => undefined).then(() => this.compact());
    this.chain = run;
    return run;
  }

  /** Espera as escritas pendentes (testes e saída do app). */
  flush(): Promise<void> {
    return this.chain.then(() => undefined, () => undefined);
  }
}
