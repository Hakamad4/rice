#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const delta = (text) =>
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

if (process.env.FAKE_CLAUDE_PIDFILE) writeFileSync(process.env.FAKE_CLAUDE_PIDFILE, String(process.pid));

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', async () => {
  if (process.env.FAKE_CLAUDE_RECORD) {
    writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin, hasApiKey: 'ANTHROPIC_API_KEY' in process.env, oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null }));
  }
  out({ type: 'system', subtype: 'init' });
  switch (mode) {
    case 'ok':
      delta('Olá');
      delta(' mundo');
      out({ type: 'result', subtype: 'success', is_error: false, result: 'Olá mundo' });
      process.exit(0);
    case 'not-logged-in':
      out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
      process.exit(1);
    case 'rate-limited':
      out({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your usage limit" });
      process.exit(1);
    case 'crash':
      delta('meio');
      process.stderr.write('boom: segfault\n');
      process.exit(2);
    case 'echo-token':
      process.stderr.write(`falha com ${process.env.CLAUDE_CODE_OAUTH_TOKEN}\n`);
      process.exit(2);
    case 'garbage':
      process.stdout.write('isto não é json\n');
      delta('fim');
      out({ type: 'result', is_error: false, result: 'fim' });
      process.exit(0);
    case 'text': {
      // resposta fixa (usada pelas capturas de documentação: o rascunho de e-mail vem daqui)
      const text = process.env.FAKE_CLAUDE_TEXT ?? '';
      delta(text);
      out({ type: 'result', subtype: 'success', is_error: false, result: text });
      process.exit(0);
    }
    case 'slow':
      delta('a');
      setTimeout(() => {
        delta('b');
        out({ type: 'result', is_error: false, result: 'ab' });
        process.exit(0);
      }, 10_000);
      break;
  }
});
