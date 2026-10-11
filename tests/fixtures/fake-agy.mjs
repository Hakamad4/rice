#!/usr/bin/env node
// Antigravity (agy) falso: imita `agy --input-format stream-json --output-format stream-json`.
// FAKE_AGY_MODE: ok (padrão, texto em pedaços ACTIVE) | done-only (texto inteiro em DONE) | quota | tools | models.
import { appendFileSync } from 'node:fs';

const mode = process.env.FAKE_AGY_MODE ?? 'ok';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const ID = process.env.FAKE_AGY_ID ?? '11111111-2222-3333-4444-555555555555';
if (process.argv[2] === 'models') {
  process.stdout.write('Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n');
  process.exit(0);
}
if (process.env.FAKE_AGY_RECORD) appendFileSync(process.env.FAKE_AGY_RECORD, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })}\n`);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_AGY_RECORD) appendFileSync(process.env.FAKE_AGY_RECORD, `${JSON.stringify({ stdin: input })}\n`);
  out({ event: 'init', conversation_id: ID, init: { model: 'fake', cwd: process.cwd(), tools: ['run_command', 'write_to_file'], permission_mode: 'always-proceed' } });
  out({ event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } });
  if (mode === 'quota') {
    out({ event: 'result', result: { conversation_id: ID, status: 'ERROR', response: '', error: 'Individual quota reached. Resets in 79h', usage: {} } });
    process.exit(0);
  }
  if (mode === 'tools') {
    out({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: "{'name':'run_command'}" } });
    out({ event: 'step_update', step_update: { step_index: 1, state: 'ERROR', step_type: 'tool', tool_name: 'run_command' } });
  }
  if (mode === 'done-only') {
    out({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'Resposta inteira de uma vez.\n' } });
  } else {
    for (const piece of ['Olá', ', ', 'mundo']) out({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: piece } });
    out({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\n' } });
  }
  const response = mode === 'done-only' ? 'Resposta inteira de uma vez.\n' : 'Olá, mundo\n';
  out({ event: 'result', result: { conversation_id: ID, status: 'SUCCESS', response, duration_seconds: 0.1, usage: { total_tokens: 10 } } });
  process.exit(0);
});
