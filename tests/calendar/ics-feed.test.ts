import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CalendarFeed } from '../../src/main/calendar/calendar-feed';
import { ICS_MAX_BYTES, IcsSubscription, normalizeIcsUrl, type IcsFetch, type IcsResponse } from '../../src/main/calendar/ics-feed';
import { makeTmpDir } from '../helpers/tmp';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const SECRET_URL = 'https://calendar.example.com/ical/SECRET-TOKEN-9f8e7d/basic.ics';
const crypto = { encrypt: (s: string) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`), decrypt: (b: Buffer) => Buffer.from(b.toString().slice(4), 'base64').toString() };
const weekly = readFileSync('tests/fixtures/ics/weekly-sp.ics', 'utf8');

const reply = (body: string, extra: Partial<IcsResponse> = {}): IcsResponse => ({ ok: true, status: 200, url: SECRET_URL, text: async () => body, ...extra });
async function setup(fetch: IcsFetch, over: { blocked?: () => string | null } = {}) {
  const dir = await makeTmpDir();
  const sub = new IcsSubscription({ dir, crypto, fetch, now: () => NOW, localZone: 'America/Sao_Paulo', ...over });
  return { sub, dir };
}

describe('normalizeIcsUrl', () => {
  it('webcal:// e webcals:// viram https://; http e lixo são recusados com mensagem clara', () => {
    expect(normalizeIcsUrl('webcal://p01-caldav.icloud.com/published/2/abc')).toMatchObject({ ok: true, url: 'https://p01-caldav.icloud.com/published/2/abc', host: 'p01-caldav.icloud.com' });
    expect(normalizeIcsUrl('  webcals://x.example.com/c.ics  ')).toMatchObject({ ok: true, url: 'https://x.example.com/c.ics' });
    expect(normalizeIcsUrl('https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics')).toMatchObject({ ok: true, host: 'outlook.office365.com' });
    expect(normalizeIcsUrl('http://x.example.com/c.ics')).toMatchObject({ ok: false, message: expect.stringContaining('https://') });
    expect(normalizeIcsUrl('')).toMatchObject({ ok: false });
    expect(normalizeIcsUrl('ftp://x.example.com/c.ics')).toMatchObject({ ok: false });
    expect(normalizeIcsUrl('https://user:pass@x.example.com/c.ics')).toMatchObject({ ok: false });
    expect(normalizeIcsUrl('https://localhost/c.ics')).toMatchObject({ ok: false });
    expect(normalizeIcsUrl('https://x.example.com/ com espaço')).toMatchObject({ ok: false });
    expect(normalizeIcsUrl(`https://x.example.com/${'a'.repeat(3000)}`)).toMatchObject({ ok: false });
  });
});

describe('IcsSubscription', () => {
  it('assina: lê uma vez, guarda o link CIFRADO e devolve os eventos; o status só traz o domínio', async () => {
    const fetch = vi.fn<IcsFetch>(async () => reply(weekly));
    const { sub, dir } = await setup(fetch);
    const r = await sub.save(SECRET_URL);
    expect(r).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(SECRET_URL);
    const status = await sub.status();
    expect(status).toMatchObject({ configured: true, host: 'calendar.example.com' });
    expect(JSON.stringify(status)).not.toContain('SECRET-TOKEN'); // o link inteiro nunca sai do main
    // em disco, só cifrado
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f)).toString()).not.toContain('SECRET-TOKEN');
    expect(readFileSync(join(dir, 'ics-url.bin')).toString()).toMatch(/^enc:/);
  });

  it('um link que não funciona NÃO é guardado', async () => {
    const { sub } = await setup(async () => reply('', { ok: false, status: 404 }));
    const r = await sub.save(SECRET_URL);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('404') });
    expect(await sub.status()).toMatchObject({ configured: false });
  });

  it('mensagens de erro nunca contêm o link (só o domínio): rede, status, não-ICS e redirecionamento para http', async () => {
    const cases: IcsFetch[] = [
      async () => { throw new Error(`ECONNREFUSED ${SECRET_URL}`); },
      async () => reply('', { ok: false, status: 403 }),
      async () => reply('<html>faça login</html>'),
      async () => reply(weekly, { url: 'http://calendar.example.com/ical/SECRET-TOKEN-9f8e7d/basic.ics' }),
    ];
    for (const f of cases) {
      const { sub } = await setup(f);
      const r = await sub.save(SECRET_URL);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain('SECRET-TOKEN');
    }
    const net = await (await setup(cases[0]!)).sub.save(SECRET_URL);
    expect(net).toMatchObject({ message: expect.stringContaining('calendar.example.com') });
  });

  it('limite de tamanho: recusa pelo content-length e, sem ele, ao ler o corpo', async () => {
    const big = await setup(async () => reply(weekly, { headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? String(ICS_MAX_BYTES + 1) : null) } }));
    expect(await big.sub.save(SECRET_URL)).toMatchObject({ ok: false, message: expect.stringContaining('5 MB') });
    const noHeader = await setup(async () => reply('BEGIN:VCALENDAR\n' + 'x'.repeat(ICS_MAX_BYTES + 10)));
    expect(await noHeader.sub.save(SECRET_URL)).toMatchObject({ ok: false, message: expect.stringContaining('5 MB') });
    // corpo em pedaços (stream): para de ler ao passar do limite
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    let n = 0;
    const streamed = await setup(async () => reply('', { body: { getReader: () => ({ read: async () => (n++ < 20 ? { done: false, value: chunk } : { done: true }), cancel: async () => { cancelled = true; } }) } }));
    expect(await streamed.sub.save(SECRET_URL)).toMatchObject({ ok: false });
    expect(cancelled).toBe(true);
    expect(n).toBeLessThan(10);
  });

  it('atualização periódica: lê o link guardado (também depois de reabrir o app) e uma falha mantém o estado com erro curto', async () => {
    let fail = false;
    const fetch = vi.fn<IcsFetch>(async () => (fail ? reply('', { ok: false, status: 500 }) : reply(weekly)));
    const { sub, dir } = await setup(fetch);
    await sub.save(SECRET_URL);
    const reopened = new IcsSubscription({ dir, crypto, fetch, now: () => NOW, localZone: 'America/Sao_Paulo' });
    const events = await reopened.refresh();
    expect(events!.map((e) => e.start)).toEqual(['2026-10-12T13:00:00.000Z', '2026-10-19T13:00:00.000Z', '2026-10-21T13:00:00.000Z', '2026-10-26T13:00:00.000Z'].slice(0, events!.length));
    expect(events![0]!.source).toBe('ics');
    fail = true;
    expect(await reopened.refresh()).toBeNull();
    expect(await reopened.status()).toMatchObject({ configured: true, error: expect.stringContaining('500') });
  });

  it('Modo 100% local: nada é assinado e, ligado depois, nada mais é lido (a mensagem explica)', async () => {
    let local: string | null = 'bloqueado';
    const fetch = vi.fn<IcsFetch>(async () => reply(weekly));
    const { sub } = await setup(fetch, { blocked: () => local });
    expect(await sub.save(SECRET_URL)).toEqual({ ok: false, message: 'bloqueado' });
    expect(fetch).not.toHaveBeenCalled();
    local = null;
    await sub.save(SECRET_URL);
    expect(fetch).toHaveBeenCalledTimes(1);
    local = 'bloqueado'; // o usuário liga o Modo 100% local depois
    expect(await sub.refresh()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await sub.status()).toMatchObject({ configured: true, blocked: 'bloqueado', error: 'bloqueado' });
  });

  it('remover apaga o arquivo e invalida leituras em andamento', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const fetch = vi.fn<IcsFetch>(async () => {
      if (first) return reply(weekly);
      await gate;
      return reply(weekly);
    });
    const { sub, dir } = await setup(fetch);
    await sub.save(SECRET_URL);
    first = false;
    const pending = sub.refresh();
    await sub.remove();
    release();
    expect(await pending).toBeNull(); // obsoleto: o link foi removido
    expect(await sub.status()).toMatchObject({ configured: false });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('CalendarFeed com ICS', () => {
  const auth = { accessToken: async () => 'T', status: async () => ({ connected: false }) };
  const ev = (id: string, title: string, start: string, source: 'google' | 'eventkit' | 'ics') => ({ id, title, start, end: new Date(Date.parse(start) + 3600_000).toISOString(), calendar: 'x', attendees: 0, source });

  it('os eventos do link entram no mesmo feed (ordenados) e somem ao esvaziar', () => {
    const feed = new CalendarFeed(auth, (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never, () => NOW);
    const change = vi.fn();
    feed.on('change', change);
    feed.addEventKit(ev('k', 'Almoço', '2026-10-12T15:00:00Z', 'eventkit'));
    feed.setIcs([ev('i', 'Planejamento', '2026-10-12T13:00:00Z', 'ics')]);
    expect(feed.events().map((e) => e.id)).toEqual(['i', 'k']);
    expect(change).toHaveBeenCalledTimes(2);
    feed.setIcs([]);
    expect(feed.events().map((e) => e.id)).toEqual(['k']);
  });

  it('o mesmo evento em mais de uma fonte aparece uma vez (Google > Calendário do macOS > link ICS)', () => {
    const feed = new CalendarFeed(auth, (async () => ({ ok: true, status: 200, json: async () => ({}) })) as never, () => NOW);
    feed.addEventKit(ev('k', 'Weekly', '2026-10-12T13:00:00Z', 'eventkit'));
    feed.setIcs([ev('i1', 'weekly', '2026-10-12T13:01:00Z', 'ics'), ev('i2', 'Outra', '2026-10-12T14:00:00Z', 'ics')]);
    expect(feed.events().map((e) => e.id)).toEqual(['k', 'i2']);
  });
});
