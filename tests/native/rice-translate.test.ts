import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { riceTranslateBinary } from '../../src/main/app/paths';

// O sidecar C++ em modo --simulate (sem modelo): prova o protocolo e a divisão em frases do binário de verdade.
// Compile antes com scripts/build-native.sh (Mac) ou cmake -S native/translate (CI). Sem o binário, o teste não roda.
const BIN = riceTranslateBinary();
const maybe = existsSync(BIN) ? describe : describe.skip;

async function talk(commands: object[]): Promise<Record<string, unknown>[]> {
  const child = spawn(BIN, ['--simulate'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: Record<string, unknown>[] = [];
  const done = new Promise<void>((resolve) => {
    createInterface({ input: child.stdout }).on('line', (l) => lines.push(JSON.parse(l)));
    child.on('exit', () => resolve());
  });
  for (const c of commands) child.stdin.write(`${JSON.stringify(c)}\n`);
  child.stdin.end();
  await done;
  return lines;
}

maybe('rice-translate --simulate', () => {
  it('diz ready, traduz por frase com o token de destino e responde pelo id', async () => {
    const out = await talk([{ cmd: 'translate', id: 7, model: '/m/x', prefix: '>>por<<', text: 'Hello everyone. How are you doing today?' }]);
    expect(out[0]).toMatchObject({ event: 'ready', backend: 'simulated', threads: 1 });
    expect(out[1]).toMatchObject({ event: 'translated', id: 7, text: '>>por<<HELLO EVERYONE. >>por<<HOW ARE YOU DOING TODAY?' });
  });

  it('erros viram evento sem derrubar o processo', async () => {
    const out = await talk([{ cmd: 'translate', id: 1, text: 'sem modelo' }, { cmd: 'nope' }, { cmd: 'translate', id: 2, model: '/m/x', text: 'ok' }]);
    expect(out[1]).toMatchObject({ event: 'error', id: 1, message: 'missing model' });
    expect(out[2]).toMatchObject({ event: 'error', message: 'unknown command: nope' });
    expect(out[3]).toMatchObject({ event: 'translated', id: 2, text: 'OK' });
  });

  it('preserva UTF-8 e texto vazio', async () => {
    const out = await talk([{ cmd: 'translate', id: 1, model: '/m/x', text: 'ação é coração.' }, { cmd: 'translate', id: 2, model: '/m/x', text: '' }]);
    expect(out[1]).toMatchObject({ text: 'AçãO é CORAçãO.' }); // o simulado só maiúscula ASCII: os bytes UTF-8 passam intactos
    expect(out[2]).toMatchObject({ event: 'translated', id: 2, text: '' });
  });
});
