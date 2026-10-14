import { describe, expect, test } from 'vitest';
import { daysUntil, parseDue } from '../../src/main/memory/due';
import { domainOf, inferOwnDomains, isMe, nameMatchesEmail, normName, orgFromEmail, peopleOf } from '../../src/main/memory/identity';

describe('identidade', () => {
  test('nomes normalizados sem acento e sem diferenciar maiúsculas', () => {
    expect(normName('  José  da  Conceição ')).toBe('jose da conceicao');
    expect(normName('ANA-Maria')).toBe(normName('ana maria'));
  });
  test('empresa pelo domínio, ignorando pessoais e o do próprio usuário', () => {
    expect(orgFromEmail('ana@acme.com')).toBe('acme');
    expect(orgFromEmail('ana@acme.com.br')).toBe('acme');
    expect(orgFromEmail('ana@mail.acme.io')).toBe('acme');
    for (const d of ['gmail.com', 'outlook.com', 'icloud.com', 'hotmail.com', 'yahoo.com.br', 'proton.me', 'protonmail.com']) expect(orgFromEmail(`x@${d}`), d).toBeNull();
    expect(orgFromEmail('eu@minhaempresa.com', ['minhaempresa.com'])).toBeNull();
    expect(orgFromEmail('sem-arroba')).toBeNull();
    expect(domainOf('A@B.COM')).toBe('b.com');
  });
  test('o domínio do usuário é inferido quando aparece em quase toda reunião', () => {
    const lists = Array.from({ length: 10 }, (_, i) => (i % 3 === 0 ? ['a@minha.com', 'x@acme.com'] : ['b@minha.com']));
    expect(inferOwnDomains(lists)).toEqual(['minha.com']);
    expect(inferOwnDomains(lists.slice(0, 4))).toEqual([]); // poucas reuniões: não chuta
    expect(inferOwnDomains(Array.from({ length: 5 }, () => ['x@acme.com']))).toEqual([]); // um cliente só nunca vira "a própria empresa"
  });
  test('"eu" é o usuário; nome × e-mail', () => {
    expect(isMe('Eu')).toBe(true);
    expect(isMe('me')).toBe(true);
    expect(isMe('Ana')).toBe(false);
    expect(nameMatchesEmail('Ana Silva', 'ana.silva@acme.com')).toBe(true);
    expect(nameMatchesEmail('Carlos', 'ana.silva@acme.com')).toBe(false);
  });
  test('pessoas e empresas de uma reunião (agenda + falantes + e-mails)', () => {
    const r = peopleOf({ names: ['Ana Silva', 'Carlos'], emails: ['ana.silva@acme.com', 'carlos@gmail.com', 'bia@acme.com'], speakers: { '2': 'Diego' }, ownDomains: ['minha.com'] });
    expect(r.orgs).toEqual(['acme']);
    expect(r.people.find((p) => p.name === 'Ana Silva')).toEqual({ name: 'Ana Silva', org: 'acme' });
    expect(r.people.some((p) => p.name === 'Bia' && p.org === 'acme')).toBe(true); // só o e-mail: pessoa pelo local-part
    expect(r.people.some((p) => p.name === 'Diego')).toBe(true);
    expect(r.people.find((p) => p.name === 'Carlos')?.org).toBeUndefined(); // gmail não é empresa (mas há 1 empresa só: vale como padrão)
  });
});

describe('prazos relativos', () => {
  // quarta, 8/out/2026
  const wed = new Date(2026, 9, 7);
  const cases: Array<[string, string | null]> = [
    ['2026-10-09', '2026-10-09'], ['2026-02-30', null], ['até sexta', '2026-10-09'], ['sexta', '2026-10-09'], ['by Friday', '2026-10-09'], ['quarta', '2026-10-07'], ['amanhã', '2026-10-08'], ['tomorrow', '2026-10-08'], ['hoje', '2026-10-07'], ['today', '2026-10-07'],
    ['semana que vem', '2026-10-12'], ['próxima semana', '2026-10-12'], ['next week', '2026-10-12'], ['fim da semana', '2026-10-09'], ['em 3 dias', '2026-10-10'], ['in two weeks', '2026-10-21'], ['dia 15', '2026-10-15'], ['15 de novembro', '2026-11-15'],
    ['November 15', '2026-11-15'], ['Nov 3rd', '2026-11-03'], ['15/10', '2026-10-15'], ['10/10/2026', '2026-10-10'], ['fim do mês', '2026-10-31'], ['mês que vem', '2026-11-01'], ['em breve', null], ['quando der', null], ['', null], ['sem prazo', null], ['next Monday', '2026-10-12'], ['segunda que vem', '2026-10-12'],
  ];
  test.each(cases)('%s → %s', (raw, want) => expect(parseDue(raw, wed)).toBe(want));
  test('virada de mês e de ano', () => {
    expect(parseDue('dia 3', new Date(2026, 9, 28))).toBe('2026-11-03'); // dia 3 já passou: o do mês seguinte
    expect(parseDue('dia 31', new Date(2026, 10, 15))).toBe('2026-12-31'); // novembro não tem 31
    expect(parseDue('semana que vem', new Date(2026, 11, 30))).toBe('2027-01-04');
    expect(parseDue('15/01', new Date(2026, 11, 20))).toBe('2027-01-15');
    expect(parseDue('em 5 dias', new Date(2026, 11, 29))).toBe('2027-01-03');
    expect(parseDue('fim do mês', new Date(2026, 1, 10))).toBe('2026-02-28');
  });
  test('o que não é data clara vira null (nunca inventa); lixo não quebra', () => {
    for (const raw of [undefined, null, 42, {}, 'logo', 'assim que possível', 'asap']) expect(parseDue(raw, wed)).toBeNull();
  });
  test('dias até o prazo', () => {
    expect(daysUntil('2026-10-09', wed)).toBe(2);
    expect(daysUntil('2026-10-05', wed)).toBe(-2);
    expect(daysUntil('2026-10-07', wed)).toBe(0);
  });
});
