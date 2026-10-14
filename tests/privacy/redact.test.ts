import { describe, expect, test } from 'vitest';
import { createRedactor, findPii, luhn, validCnpj, validCpf } from '../../src/main/privacy/redact';

const types = (text: string) => findPii(text).map((h) => `${h.type}:${h.value}`);

describe('validações', () => {
  test('CPF com dígitos verificadores; repetidos e inválidos não passam', () => {
    expect(validCpf('529.982.247-25')).toBe(true);
    expect(validCpf('52998224725')).toBe(true);
    expect(validCpf('529.982.247-24')).toBe(false);
    expect(validCpf('111.111.111-11')).toBe(false);
    expect(validCpf('123')).toBe(false);
  });
  test('CNPJ com dígitos verificadores', () => {
    expect(validCnpj('11.222.333/0001-81')).toBe(true);
    expect(validCnpj('11222333000181')).toBe(true);
    expect(validCnpj('11.222.333/0001-82')).toBe(false);
    expect(validCnpj('00000000000000')).toBe(false);
  });
  test('cartão por Luhn', () => {
    expect(luhn('4111 1111 1111 1111')).toBe(true);
    expect(luhn('5500-0000-0000-0004')).toBe(true);
    expect(luhn('4111 1111 1111 1112')).toBe(false);
    expect(luhn('0000000000000000')).toBe(false);
  });
});

describe('cada padrão', () => {
  test('CPF e CNPJ formatados ou só dígitos (com DV válido)', () => {
    expect(types('meu CPF é 529.982.247-25, ok')).toEqual(['CPF:529.982.247-25']);
    expect(types('cpf 52998224725')).toEqual(['CPF:52998224725']);
    expect(types('empresa 11.222.333/0001-81 e 11222333000181')).toEqual(['CNPJ:11.222.333/0001-81', 'CNPJ:11222333000181']);
  });
  test('cartão (13 a 19 dígitos, espaços ou hífens, Luhn)', () => {
    expect(types('cartão 4111 1111 1111 1111 vence 12/28')).toEqual(['CARD:4111 1111 1111 1111']);
    expect(types('5500-0000-0000-0004')).toEqual(['CARD:5500-0000-0000-0004']);
    expect(types('4111111111111111')).toEqual(['CARD:4111111111111111']);
  });
  test('e-mail', () => {
    expect(types('fale com ana.silva+rice@acme.com.br ou JOAO@Exemplo.ORG.')).toEqual(['EMAIL:ana.silva+rice@acme.com.br', 'EMAIL:JOAO@Exemplo.ORG']);
  });
  test('telefone BR e internacional', () => {
    expect(types('ligue (11) 91234-5678')).toEqual(['PHONE:(11) 91234-5678']);
    expect(types('ou 11 91234-5678 / 11-3456-7890')).toEqual(['PHONE:11 91234-5678', 'PHONE:11-3456-7890']);
    expect(types('whatsapp +55 11 91234-5678')).toEqual(['PHONE:+55 11 91234-5678']);
    expect(types('US +1 415 555 2671 e 415-555-2671')).toEqual(['PHONE:+1 415 555 2671', 'PHONE:415-555-2671']);
    expect(types('só o final 91234-5678')).toEqual(['PHONE:91234-5678']);
  });
  test('RG (melhor esforço: só com a palavra RG antes) e CEP', () => {
    expect(types('RG: 12.345.678-9')).toEqual(['RG:12.345.678-9']);
    expect(types('RG nº 123456789 emitido')).toEqual(['RG:123456789']);
    expect(types('o número 12.345.678-9 sozinho')).toEqual([]);
    expect(types('CEP 01310-100, São Paulo')).toEqual(['ZIP:01310-100']);
    expect(types('CEP: 01310100')).toEqual(['ZIP:01310100']);
    expect(types('01310100 sem a palavra')).toEqual([]);
  });
});

describe('falsos positivos comuns ficam como estão', () => {
  test('números de pedido, protocolos e valores', () => {
    for (const text of ['Pedido 123456789', 'pedido nº 20261013001', 'protocolo 2026101300123456', 'NF 000123456', 'R$ 1.234.567,89', 'total 1234567890', 'ID 4812734', 'ticket 99887766554433']) expect(types(text), text).toEqual([]);
  });
  test('datas, horas e anos', () => {
    for (const text of ['reunião em 12/03/2024', 'dia 2026-10-13', '13/10/2026 às 10:30:00', 'ano fiscal 2024-2025', 'versão 3.14.159', 'de 2019-2023']) expect(types(text), text).toEqual([]);
  });
  test('números de 11 ou 14 dígitos com DV inválido; cartão que falha no Luhn', () => {
    expect(types('12345678901')).toEqual([]); // DV não bate
    expect(types('12345678000199')).toEqual([]);
    expect(types('4111 1111 1111 1112')).toEqual([]);
  });
  test('"@" sem domínio e URLs sem e-mail', () => {
    expect(types('use o @fulano no chat e https://exemplo.com/a@b')).toEqual([]);
  });
});

describe('ida e volta', () => {
  test('marcadores [CPF 1], [EMAIL 1]…; o mesmo valor (mesmo em formato diferente) repete o marcador; a resposta é restaurada', () => {
    const r = createRedactor();
    const sent = r.redact('Ana (CPF 529.982.247-25, ana@acme.com) e Beto (cpf 52998224725). Fale com Carla: carla@acme.com, (11) 91234-5678.');
    expect(sent).toBe('Ana (CPF [CPF 1], [EMAIL 1]) e Beto (cpf [CPF 1]). Fale com Carla: [EMAIL 2], [PHONE 1].');
    expect(r.count()).toBe(5);
    expect(sent).not.toMatch(/529|acme|91234/);
    const answer = 'Resumo: [CPF 1] pertence à Ana; contato [EMAIL 2] / [PHONE 1]; [EMAIL 1] também. Marcador [CPF 9] desconhecido.';
    expect(r.restore(answer)).toBe('Resumo: 529.982.247-25 pertence à Ana; contato carla@acme.com / (11) 91234-5678; ana@acme.com também. Marcador [CPF 9] desconhecido.');
  });

  test('restauração em fluxo: marcadores cortados ao meio entre pedaços voltam inteiros', () => {
    const r = createRedactor();
    r.redact('cpf 529.982.247-25 e ana@acme.com');
    const full = 'O [CPF 1] é da Ana, que usa [EMAIL 1]. Fim.';
    for (let a = 1; a < full.length; a++) {
      for (let b = a + 1; b < full.length; b += 3) {
        const s = r.stream();
        const out = s.feed(full.slice(0, a)) + s.feed(full.slice(a, b)) + s.feed(full.slice(b)) + s.flush();
        expect(out, `${a},${b}`).toBe('O 529.982.247-25 é da Ana, que usa ana@acme.com. Fim.');
      }
    }
    const s = r.stream();
    expect(s.feed('colchete [solto') + s.flush()).toBe('colchete [solto');
  });

  test('o mapa é por chamada e só em memória: outro redator não restaura (e nada é gravado)', () => {
    const a = createRedactor();
    const placeholder = a.redact('CPF 529.982.247-25');
    expect(placeholder).toBe('CPF [CPF 1]');
    expect(createRedactor().restore(placeholder)).toBe('CPF [CPF 1]');
  });

  test('texto sem dados pessoais passa intacto; maiúsculas/minúsculas no marcador da IA', () => {
    const r = createRedactor();
    expect(r.redact('nada sensível aqui, pedido 123456789')).toBe('nada sensível aqui, pedido 123456789');
    expect(r.count()).toBe(0);
    r.redact('mail ana@acme.com');
    expect(r.restore('use [email 1]')).toBe('use ana@acme.com');
  });
});
