import { expect, test } from 'vitest';
import { parseSse, type SseEvent } from '../../src/main/ai/sse';
import { classifyHttpStatus, classifyMessage, redact } from '../../src/main/ai/errors';

const enc = new TextEncoder();
async function* chunks(...parts: string[]) {
  for (const p of parts) yield enc.encode(p);
}
async function collect(body: AsyncIterable<Uint8Array>) {
  const out: SseEvent[] = [];
  for await (const e of parseSse(body)) out.push(e);
  return out;
}

test('eventos simples, com e sem nome', async () => {
  expect(await collect(chunks('event: a\ndata: 1\n\ndata: 2\n\n'))).toEqual([
    { event: 'a', data: '1' },
    { event: 'message', data: '2' },
  ]);
});

test('eventos cortados no meio de uma linha e de um caractere UTF-8', async () => {
  const bytes = enc.encode('data: olá ✓\n\n');
  async function* split() {
    yield bytes.slice(0, 8); // corta no meio do "á"/✓
    yield bytes.slice(8);
  }
  expect(await collect(split())).toEqual([{ event: 'message', data: 'olá ✓' }]);
});

test('aceita CRLF, CR, comentários e data em várias linhas', async () => {
  expect(await collect(chunks(': keep-alive\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n'))).toEqual([{ event: 'x', data: 'a\nb' }]);
  expect(await collect(chunks('data: 1\r', '\n\r', '\n'))).toEqual([{ event: 'message', data: '1' }]);
});

test('último evento sem linha em branco final ainda sai; vazio não gera evento', async () => {
  expect(await collect(chunks('data: fim'))).toEqual([{ event: 'message', data: 'fim' }]);
  expect(await collect(chunks('\n\n: só comentário\n\n'))).toEqual([]);
});

test('classifyHttpStatus e classifyMessage', () => {
  expect(classifyHttpStatus(401, '')).toBe('auth');
  expect(classifyHttpStatus(403, '')).toBe('auth');
  expect(classifyHttpStatus(429, '')).toBe('rate-limit');
  expect(classifyHttpStatus(400, 'API key not valid. Please pass a valid API key.')).toBe('auth');
  expect(classifyHttpStatus(500, 'boom')).toBe('other');
  expect(classifyMessage('unexpected status 401 Unauthorized')).toBe('auth');
  expect(classifyMessage('Waiting for authentication...')).toBe('auth');
  expect(classifyMessage('You exceeded your current quota')).toBe('rate-limit');
  expect(classifyMessage('getaddrinfo ENOTFOUND api.openai.com')).toBe('network');
  expect(classifyMessage('algo estranho')).toBe('other');
});

test('redact remove segredos (e ignora valores curtos/vazios)', () => {
  expect(redact('erro com sk-ant-api03-SEGREDO123 aqui', ['sk-ant-api03-SEGREDO123', null, ''])).toBe('erro com *** aqui');
  expect(redact('abc', ['abc'])).toBe('abc'); // curto demais para ser segredo
});
