import { EventEmitter } from 'node:events';
import type { FetchLike } from './google-auth';
import { fetchGoogleEvents, mergeEvents, type CalEvent } from './google-events';

export const REFRESH_MS = 5 * 60_000;

/** Eventos do Google + EventKit unidos. Emite 'change' quando a lista muda. */
export class CalendarFeed extends EventEmitter {
  private google: CalEvent[] = [];
  private eventkit = new Map<string, CalEvent>();
  private calendars = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Geração monotônica: um refresh só grava se ninguém o invalidou nem começou outro depois. */
  private generation = 0;
  lastError: string | null = null;

  constructor(
    private readonly auth: { accessToken(): Promise<string>; status(): Promise<{ connected: boolean }> },
    private readonly fetch: FetchLike,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  events(): CalEvent[] {
    return mergeEvents(this.google, [...this.eventkit.values()]);
  }

  calendarCount(): number {
    return this.calendars;
  }

  addEventKit(ev: CalEvent): void {
    this.eventkit.set(ev.id, ev);
    this.emit('change');
  }

  /** Troca TODOS os eventos do Calendário do macOS pela lista nova (a lista completa dos próximos dias, com dia inteiro). */
  setEventKit(events: CalEvent[]): void {
    this.eventkit = new Map(events.map((e) => [e.id, e]));
    this.emit('change');
  }

  /** Busca no Google (se conectado). Erros viram `lastError`; a lista anterior é mantida. */
  /** Descarta refreshes em andamento e limpa os eventos do Google (usar ao desconectar). */
  invalidate(): void {
    this.generation++;
    const had = this.google.length > 0;
    this.google = [];
    this.calendars = 0;
    this.lastError = null;
    if (had) this.emit('change');
  }

  async refresh(): Promise<void> {
    const gen = ++this.generation;
    try {
      if (!(await this.auth.status()).connected) {
        if (gen !== this.generation) return;
        const had = this.google.length > 0;
        this.google = [];
        this.calendars = 0;
        this.lastError = null;
        if (had) this.emit('change');
        return;
      }
      const r = await fetchGoogleEvents(await this.auth.accessToken(), this.fetch, this.now());
      if (gen !== this.generation) return; // obsoleto: desconectou ou outro refresh começou
      this.google = r.events;
      this.calendars = r.calendars;
      this.lastError = null;
    } catch (err) {
      if (gen !== this.generation) return;
      this.lastError = (err as Error).message;
    }
    this.emit('change');
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
