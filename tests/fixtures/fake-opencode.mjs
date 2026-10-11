#!/usr/bin/env node
// OpenCode falso: imita `opencode run --format json`, `opencode models` e `opencode auth list`.
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_MODE ?? 'ok';
const [cmd, sub] = process.argv.slice(2);
const out = (obj) => process.stdout.write(`${JSON.stringify({ timestamp: 1, sessionID: 'ses_x', ...obj })}\n`);

if (cmd === 'models') {
  process.stdout.write(process.env.FAKE_MODELS ?? '');
  process.exit(0);
}
if (cmd === 'auth' && sub === 'list') {
  process.stdout.write(process.env.FAKE_AUTH ?? 'No authenticated integrations\n');
  process.exit(0);
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_RECORD) {
    const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_AUTOUPDATE', 'XDG_CONFIG_HOME'];
    writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin, env: Object.fromEntries(keys.map((k) => [k, process.env[k] ?? null])) }));
  }
  switch (mode) {
    case 'ok':
      out({ type: 'step_start', part: { type: 'step-start' } });
      out({ type: 'tool_use', part: { type: 'tool', tool: 'write', state: { status: 'error' } } });
      out({ type: 'text', part: { type: 'text', text: 'Olá ' } });
      out({ type: 'text', part: { type: 'text', text: 'OpenCode' } });
      process.exit(0);
    case 'no-route':
      out({ type: 'error', error: { type: 'provider.no-route', message: 'Model unavailable: anthropic/claude-sonnet-4-5' } });
      process.exit(1);
    case 'free-tier':
      out({ type: 'error', error: { type: 'provider.auth', message: "OpenCode's free tier can only be used from within OpenCode", status: 403 } });
      process.exit(1);
    case 'rate-limit':
      out({ type: 'error', error: { type: 'provider.rate-limit', message: 'Rate limit exceeded (429)' } });
      process.exit(1);
    case 'hang':
      setTimeout(() => process.exit(0), 60_000);
      break;
  }
});
