#!/usr/bin/env node
// Codex falso: imita `codex exec --json` (JSONL no stdout).
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_MODE ?? 'ok';
// `codex features list`: nome, estágio, ligado (só alguns nomes, como numa versão real)
if (process.argv[2] === 'features' && process.argv[3] === 'list') {
  if (process.env.FAKE_NO_FEATURES) process.exit(2);
  for (const [n, s, e] of [['shell_tool', 'stable', true], ['apps', 'stable', true], ['browser_use', 'stable', true], ['computer_use', 'stable', true], ['fast_mode', 'stable', true], ['plugins', 'stable', true]]) console.log(`${n.padEnd(40)} ${s.padEnd(18)} ${e}`);
  process.exit(0);
}
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_RECORD) {
    const env = Object.fromEntries(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY'].map((k) => [k, process.env[k] ?? null]));
    writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin, env, path: process.env.PATH }));
  }
  out({ type: 'thread.started', thread_id: 't1' });
  out({ type: 'turn.started' });
  switch (mode) {
    case 'ok':
      out({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'Primeira parte.' } });
      out({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'Segunda parte.' } });
      out({ type: 'turn.completed', usage: {} });
      process.exit(0);
    case 'auth':
      out({ type: 'error', message: 'Reconnecting... 1/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses)' });
      setTimeout(() => process.exit(0), 60_000); // fica "tentando de novo": o Rice precisa matar
      break;
    case 'rate':
      out({ type: 'turn.failed', error: { message: 'You have hit your usage limit. Try again later.' } });
      process.exit(1);
    case 'hang':
      setTimeout(() => process.exit(0), 60_000);
      break;
    case 'crash':
      process.stderr.write('panic: algo quebrou\n');
      process.exit(2);
  }
});
