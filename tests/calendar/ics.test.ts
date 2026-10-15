import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { icsEvents, parseDt, parseDuration, parseLine, parseRule, resolveZone, unfold, unescapeText, wallToUtc } from '../../src/main/calendar/ics';

const fixture = (name: string) => readFileSync(`tests/fixtures/ics/${name}.ics`, 'utf8');
const win = (from: string, to: string) => ({ from: Date.parse(from), to: Date.parse(to) });
const starts = (events: Array<{ start: string }>) => events.map((e) => e.start);
const SP = 'America/Sao_Paulo';
const wrap = (body: string, head = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${head}BEGIN:VEVENT\r\nUID:t@x\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('ICS: linhas, parâmetros e datas', () => {
  it('desdobra linhas, ignora BOM e entende parâmetros com aspas, vírgula e dois-pontos', () => {
    expect(unfold('﻿A:1\r\n 2\r\nB:x\n\ty')).toEqual(['A:12', 'B:xy']);
    expect(parseLine('ATTENDEE;CN="Silva, José: Dir";PARTSTAT=ACCEPTED:mailto:j@x.com')).toEqual({ name: 'ATTENDEE', params: { CN: 'Silva, José: Dir', PARTSTAT: 'ACCEPTED' }, value: 'mailto:j@x.com' });
    expect(parseLine('SEM DOIS PONTOS')).toBeNull();
    expect(unescapeText('a\\, b\; c\\\\d\\nfim')).toBe('a, b; c\\d\nfim');
  });

  it('datas: UTC, local, só dia, e o fuso do TZID', () => {
    expect(parseDt('20261012T100000Z', {})).toMatchObject({ utc: true, dateOnly: false, wall: { y: 2026, m: 10, d: 12, h: 10 } });
    expect(parseDt('20261012', { VALUE: 'DATE' })).toMatchObject({ dateOnly: true });
    expect(parseDt('20261012T1000', {})?.wall.mi).toBe(0);
    expect(parseDt('lixo', {})).toBeNull();
    expect(parseDuration('PT1H30M')).toBe(5_400_000);
    expect(parseDuration('P1D')).toBe(86_400_000);
    expect(parseDuration('-PT15M')).toBe(-900_000);
  });

  it('fusos: São Paulo, Nova York (com horário de verão), nomes do Windows e caminhos do tipo mozilla', () => {
    expect(new Date(wallToUtc({ y: 2026, m: 10, d: 12, h: 10, mi: 0, s: 0 }, SP)).toISOString()).toBe('2026-10-12T13:00:00.000Z');
    expect(new Date(wallToUtc({ y: 2026, m: 10, d: 26, h: 9, mi: 0, s: 0 }, 'America/New_York')).toISOString()).toBe('2026-10-26T13:00:00.000Z'); // EDT
    expect(new Date(wallToUtc({ y: 2026, m: 11, d: 2, h: 9, mi: 0, s: 0 }, 'America/New_York')).toISOString()).toBe('2026-11-02T14:00:00.000Z'); // EST
    expect(() => wallToUtc({ y: 2026, m: 3, d: 8, h: 2, mi: 30, s: 0 }, 'America/New_York')).not.toThrow(); // a hora que não existe
    expect(resolveZone('E. South America Standard Time')).toBe(SP);
    expect(resolveZone('Eastern Standard Time')).toBe('America/New_York');
    expect(resolveZone('/mozilla.org/20050126_1/America/New_York')).toBe('America/New_York');
    expect(resolveZone('Fuso Inventado')).toBeNull();
  });

  it('RRULE: campos principais e regras sem suporte', () => {
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,-1FR;COUNT=6;WKST=SU')).toMatchObject({ freq: 'WEEKLY', interval: 2, count: 6, wkst: 0, byDay: [{ n: 0, day: 1 }, { n: -1, day: 5 }] });
    expect(parseRule('FREQ=HOURLY')).toBeNull();
    expect(parseRule('SEM=FREQ')).toBeNull();
  });
});

describe('ICS: eventos', () => {
  it('semanal (seg e qua) em São Paulo com EXDATE: pula a quarta excluída; título, link, participantes e calendário', () => {
    const ev = icsEvents(fixture('weekly-sp'), win('2026-10-12T00:00:00Z', '2026-10-23T00:00:00Z'), SP);
    expect(starts(ev)).toEqual(['2026-10-12T13:00:00.000Z', '2026-10-19T13:00:00.000Z', '2026-10-21T13:00:00.000Z']);
    expect(ev[0]).toMatchObject({ title: 'Planejamento semanal', end: '2026-10-12T14:00:00.000Z', calendar: 'Trabalho', source: 'ics', joinUrl: 'https://meet.google.com/abc-defg-hij', attendees: 2, attendeeNames: ['Silva, Jose', 'Ana Souza'], attendeeEmails: ['jose.silva@example.com', 'ana@example.com'] });
    expect(ev[0]!.id).toBe(`ics:weekly-1@example.com:${Date.parse('2026-10-12T13:00:00Z')}`);
  });

  it('Nova York: a hora local (9h) é mantida ao cruzar o fim do horário de verão (13h UTC → 14h UTC)', () => {
    const ev = icsEvents(fixture('weekly-ny-dst'), win('2026-10-25T00:00:00Z', '2026-12-30T00:00:00Z'), SP);
    expect(starts(ev)).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z', '2026-11-16T14:00:00.000Z']); // COUNT=4
    expect(ev[1]!.end).toBe('2026-11-02T14:30:00.000Z');
  });

  it('dia inteiro: início e fim à meia-noite local, vários dias, e sem DTEND dura um dia', () => {
    const ev = icsEvents(fixture('allday'), win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), SP);
    expect(ev.map((e) => [e.title, e.allDay, e.start, e.end])).toEqual([
      ['Dia do Professor', true, '2026-10-15T03:00:00.000Z', '2026-10-16T03:00:00.000Z'],
      ['Offsite', true, '2026-10-20T03:00:00.000Z', '2026-10-23T03:00:00.000Z'],
      ['Sem fim', true, '2026-10-25T03:00:00.000Z', '2026-10-26T03:00:00.000Z'],
    ]);
  });

  it('exceções: instância remarcada (RECURRENCE-ID) troca a original, a cancelada some, e o evento cancelado não aparece', () => {
    const ev = icsEvents(fixture('exceptions'), win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), SP);
    expect(ev.map((e) => [e.title, e.start])).toEqual([
      ['Daily', '2026-10-12T13:00:00.000Z'],
      ['Daily (remarcada)', '2026-10-13T17:00:00.000Z'],
      ['Daily', '2026-10-15T13:00:00.000Z'],
      ['Daily', '2026-10-16T13:00:00.000Z'],
    ]);
    expect(ev.some((e) => e.title === 'Cancelada')).toBe(false);
  });

  it('Outlook/Microsoft 365: nomes de fuso do Windows, link do Teams na descrição e alarme ignorado', () => {
    const ev = icsEvents(fixture('outlook'), win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), 'Europe/Paris');
    expect(ev.map((e) => [e.title, e.start])).toEqual([
      ['Call NY', '2026-10-15T13:00:00.000Z'], // 9h EDT
      ['Reuniao Outlook BR', '2026-10-15T17:00:00.000Z'], // 14h BRT
    ]);
    expect(ev[1]!.joinUrl).toBe('https://teams.microsoft.com/l/meetup-join/abc123');
  });

  it('mensal na 2ª terça, até uma data (UNTIL), e o último dia do mês', () => {
    const second = icsEvents(wrap('DTSTART;TZID=America/Sao_Paulo:20261013T100000\r\nDTEND;TZID=America/Sao_Paulo:20261013T110000\r\nRRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20261231T000000Z\r\nSUMMARY:Mensal'), win('2026-10-01T00:00:00Z', '2027-02-01T00:00:00Z'), SP);
    expect(starts(second)).toEqual(['2026-10-13T13:00:00.000Z', '2026-11-10T13:00:00.000Z', '2026-12-08T13:00:00.000Z']);
    const last = icsEvents(wrap('DTSTART;TZID=America/Sao_Paulo:20261031T090000\r\nDTEND;TZID=America/Sao_Paulo:20261031T100000\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3\r\nSUMMARY:Fechamento'), win('2026-10-01T00:00:00Z', '2027-03-01T00:00:00Z'), SP);
    expect(starts(last)).toEqual(['2026-10-31T12:00:00.000Z', '2026-11-30T12:00:00.000Z', '2026-12-31T12:00:00.000Z']);
  });

  it('semanal a cada 2 semanas e anual', () => {
    const biweekly = icsEvents(wrap('DTSTART;TZID=America/Sao_Paulo:20261012T100000\r\nDTEND;TZID=America/Sao_Paulo:20261012T110000\r\nRRULE:FREQ=WEEKLY;INTERVAL=2\r\nSUMMARY:Quinzenal'), win('2026-10-01T00:00:00Z', '2026-11-20T00:00:00Z'), SP);
    expect(starts(biweekly)).toEqual(['2026-10-12T13:00:00.000Z', '2026-10-26T13:00:00.000Z', '2026-11-09T13:00:00.000Z']);
    const yearly = icsEvents(wrap('DTSTART;VALUE=DATE:20200229\r\nRRULE:FREQ=YEARLY\r\nSUMMARY:Bissexto'), win('2027-01-01T00:00:00Z', '2029-01-01T00:00:00Z'), SP);
    expect(yearly.every((e) => e.allDay)).toBe(true); // 29/02 só existe em ano bissexto: 2028
    expect(starts(yearly)).toEqual(['2028-02-29T03:00:00.000Z']);
  });

  it('horário flutuante usa o fuso padrão do calendário (X-WR-TIMEZONE) ou o do computador; UTC fica como está', () => {
    const floating = (head: string, zone: string) => icsEvents(wrap('DTSTART:20261012T100000\r\nDTEND:20261012T110000\r\nSUMMARY:Flutuante', head), win('2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z'), zone);
    expect(starts(floating('X-WR-TIMEZONE:America/New_York\r\n', SP))).toEqual(['2026-10-12T14:00:00.000Z']);
    expect(starts(floating('', SP))).toEqual(['2026-10-12T13:00:00.000Z']);
    const utc = icsEvents(wrap('DTSTART:20261012T100000Z\r\nDTEND:20261012T110000Z\r\nSUMMARY:UTC'), win('2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z'), SP);
    expect(starts(utc)).toEqual(['2026-10-12T10:00:00.000Z']);
  });

  it('só devolve o que cai na janela e sem título vira "(sem título)"', () => {
    const one = wrap('DTSTART:20261012T100000Z\r\nDTEND:20261012T110000Z');
    expect(icsEvents(one, win('2026-10-12T10:30:00Z', '2026-10-12T12:00:00Z'), SP)).toHaveLength(1); // em andamento
    expect(icsEvents(one, win('2026-10-12T11:00:00Z', '2026-10-12T12:00:00Z'), SP)).toHaveLength(0); // já terminou
    expect(icsEvents(one, win('2026-10-12T00:00:00Z', '2026-10-12T10:00:00Z'), SP)).toHaveLength(0); // ainda não começou
    expect(icsEvents(one, win('2026-10-12T00:00:00Z', '2026-10-13T00:00:00Z'), SP)[0]!.title).toBe('(sem título)');
  });

  it('lixo e arquivos estranhos não quebram', () => {
    expect(icsEvents('', win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), SP)).toEqual([]);
    expect(icsEvents('<html>login</html>', win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), SP)).toEqual([]);
    expect(icsEvents(wrap('DTSTART:isso-nao-e-data\r\nSUMMARY:x'), win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), SP)).toEqual([]);
    expect(icsEvents(wrap('DTSTART:20261012T100000Z\r\nRRULE:FREQ=SECONDLY\r\nSUMMARY:x'), win('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'), SP)).toHaveLength(1); // regra sem suporte: só o primeiro
  });

  it('uma recorrência diária de anos atrás é expandida sem travar', () => {
    const t0 = Date.now();
    const ev = icsEvents(wrap('DTSTART:20150101T130000Z\r\nDTEND:20150101T133000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Daily antiga'), win('2026-10-12T00:00:00Z', '2026-10-15T00:00:00Z'), SP);
    expect(ev).toHaveLength(3);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
