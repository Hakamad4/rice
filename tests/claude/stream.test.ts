import { describe, expect, test } from 'vitest';
import { classifyClaudeError, parseClaudeLine } from '../../src/main/claude/stream';

describe('parseClaudeLine', () => {
  test('extrai text_delta', () => {
    const line = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá' } } });
    expect(parseClaudeLine(line)).toEqual({ kind: 'delta', text: 'Olá' });
  });

  test('extrai result de sucesso', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Olá mundo' });
    expect(parseClaudeLine(line)).toEqual({ kind: 'result', isError: false, text: 'Olá mundo' });
  });

  test('extrai result de erro', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    expect(parseClaudeLine(line)).toEqual({ kind: 'result', isError: true, text: 'Not logged in · Please run /login' });
  });

  test('result sem campo result vira texto vazio', () => {
    expect(parseClaudeLine('{"type":"result","is_error":true}')).toEqual({ kind: 'result', isError: true, text: '' });
  });

  test('ignora outros eventos, linhas vazias e lixo', () => {
    expect(parseClaudeLine('{"type":"system","subtype":"init"}')).toBeNull();
    expect(parseClaudeLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } } }))).toBeNull();
    expect(parseClaudeLine('')).toBeNull();
    expect(parseClaudeLine('   ')).toBeNull();
    expect(parseClaudeLine('não é json')).toBeNull();
    expect(parseClaudeLine('null')).toBeNull();
  });
});

describe('classifyClaudeError', () => {
  test.each([
    ['Not logged in · Please run /login', 'not-logged-in'],
    ['Invalid API key · Please run /login', 'not-logged-in'],
    ['OAuth token has expired. authentication_failed', 'not-logged-in'],
    ["You've hit your usage limit · resets 6pm", 'rate-limited'],
    ['Claude AI usage limit reached', 'rate-limited'],
    ['rate_limit_error', 'rate-limited'],
    ['Something exploded', 'failed'],
    ['', 'failed'],
  ] as const)('%s → %s', (msg, kind) => {
    expect(classifyClaudeError(msg)).toBe(kind);
  });
});
