import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, test } from 'vitest';

const run = promisify(execFile);
const PKG = resolve(__dirname, '../../native/rice-detector');
const BIN = resolve(PKG, '.build/release/rice-detector');

beforeAll(async () => {
  await run('swift', ['build', '-c', 'release', '--package-path', PKG], { maxBuffer: 64 * 1024 * 1024 });
}, 600_000);

async function match(bundleId: string): Promise<string | null> {
  const { stdout } = await run(BIN, ['--match', bundleId]);
  return JSON.parse(stdout).app;
}

describe('--match', () => {
  test.each([
    ['us.zoom.xos', 'Zoom'],
    ['com.microsoft.teams2', 'Microsoft Teams'],
    ['com.google.Chrome', 'Google Chrome'],
    ['com.google.Chrome.helper', 'Google Chrome'],
    ['company.thebrowser.Browser', 'Arc'],
    ['com.apple.Safari', 'Safari'],
    ['com.apple.WebKit.GPU', 'Safari'],
    ['org.mozilla.firefox', 'Firefox'],
    ['com.microsoft.edgemac.helper', 'Microsoft Edge'],
    ['com.brave.Browser.helper', 'Brave'],
    ['com.tinyspeck.slackmacgap.helper', 'Slack'],
    ['com.apple.FaceTime', 'FaceTime'],
    ['com.apple.avconferenced', 'FaceTime'],
    ['com.hnc.Discord.helper', 'Discord'],
    ['Cisco-Systems.Spark', 'Webex'],
  ])('%s → %s', async (bundleId, app) => {
    expect(await match(bundleId)).toBe(app);
  });

  test.each(['com.rice.audio', 'com.apple.VoiceMemos', '', 'com.google.Chromecast'])('%s → null', async (bundleId) => {
    expect(await match(bundleId)).toBeNull();
  });
});

async function simulate(steps: string[][]): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await run(BIN, ['--simulate-mic', JSON.stringify(steps)]);
  return stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('--simulate-mic', () => {
  test('emite in-use uma vez por app mesmo com vários processos', async () => {
    const events = await simulate([
      ['com.google.Chrome.helper'],
      ['com.google.Chrome.helper', 'com.google.Chrome'],
      ['com.google.Chrome'],
      [],
    ]);
    expect(events).toEqual([
      { event: 'mic-in-use', app: 'Google Chrome', bundleId: 'com.google.Chrome.helper' },
      { event: 'mic-released', app: 'Google Chrome', bundleId: 'com.google.Chrome.helper' },
    ]);
  });

  test('ignora apps fora da lista e trata apps independentes', async () => {
    const events = await simulate([
      ['com.rice.audio', 'us.zoom.xos'],
      ['com.rice.audio', 'us.zoom.xos', 'com.tinyspeck.slackmacgap'],
      ['com.rice.audio', 'com.tinyspeck.slackmacgap'],
    ]);
    expect(events).toEqual([
      { event: 'mic-in-use', app: 'Zoom', bundleId: 'us.zoom.xos' },
      { event: 'mic-in-use', app: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' },
      { event: 'mic-released', app: 'Zoom', bundleId: 'us.zoom.xos' },
    ]);
  });
});

async function due(now: string, events: Array<{ id: string; start: string; end: string }>, announced: string[] = []) {
  const input = JSON.stringify({ now, announced, events: events.map((e) => ({ ...e, title: e.id })) });
  const { stdout } = await run(BIN, ['--simulate-upcoming', input]);
  return JSON.parse(stdout) as string[];
}

describe('--simulate-upcoming', () => {
  const now = '2026-10-08T14:30:00-03:00';
  test('janela: de 2 min atrás até 60 s à frente', async () => {
    const ids = await due(now, [
      { id: 'cedo', start: '2026-10-08T14:27:59-03:00', end: '2026-10-08T15:00:00-03:00' },
      { id: 'limite-inferior', start: '2026-10-08T14:28:00-03:00', end: '2026-10-08T15:00:00-03:00' },
      { id: 'agora', start: '2026-10-08T14:29:00-03:00', end: '2026-10-08T15:00:00-03:00' },
      { id: 'logo', start: '2026-10-08T14:31:00-03:00', end: '2026-10-08T15:00:00-03:00' },
      { id: 'depois', start: '2026-10-08T14:31:01-03:00', end: '2026-10-08T15:00:00-03:00' },
    ]);
    expect(ids).toEqual(['limite-inferior', 'agora', 'logo']);
  });

  test('não repete eventos já anunciados', async () => {
    const ids = await due(now, [{ id: 'a', start: now, end: '2026-10-08T15:00:00-03:00' }], ['a']);
    expect(ids).toEqual([]);
  });
});

test('--once reporta estado sem pedir permissão', async () => {
  const { stdout } = await run(BIN, ['--once'], { timeout: 10_000 });
  const snapshot = JSON.parse(stdout);
  expect(snapshot.event).toBe('snapshot');
  expect(Array.isArray(snapshot.micInUse)).toBe(true);
  expect(['granted', 'denied', 'notDetermined']).toContain(snapshot.calendarAccess);
  expect(Array.isArray(snapshot.upcoming)).toBe(true);
});

test('responde a current-event antes de encerrar com EOF no stdin', async () => {
  const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  const closed = new Promise<void>((resolveClose, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout aguardando encerramento')), 10_000);
    child.once('error', reject);
    child.once('close', () => {
      clearTimeout(timeout);
      resolveClose();
    });
  });
  child.stdin.end('{"cmd":"current-event"}\n');
  await closed;
  const hasCurrentEvent = stdout.split('\n').filter(Boolean).some((line) => JSON.parse(line).event === 'current-event');
  expect(hasCurrentEvent).toBe(true);
}, 10_000);

describe('default-input (entrada padrão do sistema)', () => {
  test('--print-input responde {id,name} (ou nulos) sem gravar nada', async () => {
    const { stdout } = await run(BIN, ['--print-input']);
    const parsed = JSON.parse(stdout) as { id: string | null; name: string | null };
    expect(Object.keys(parsed).sort()).toEqual(['id', 'name']);
    expect(parsed.id === null).toBe(parsed.name === null);
    if (parsed.id !== null) expect(typeof parsed.name).toBe('string');
  });

  test('o modo watch anuncia default-input ao abrir e o comando current-input repete', async () => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines: Array<Record<string, unknown>> = [];
    let buffer = '';
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) lines.push(JSON.parse(line));
      }
    });
    try {
      child.stdin.write('{"cmd":"current-input"}\n');
      await new Promise((r) => setTimeout(r, 1500));
      const inputs = lines.filter((l) => l.event === 'default-input');
      expect(inputs.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(inputs[0]!).sort()).toEqual(['event', 'id', 'name']);
      expect(inputs[1]).toEqual(inputs[0]); // o mesmo dispositivo: current-input repete o estado
      expect(lines.some((l) => l.event === 'error')).toBe(false);
    } finally {
      child.kill();
    }
  });
});

describe('--print-inputs (escolha do microfone)', () => {
  test('lista as entradas do CoreAudio com transporte, padrão e em uso; só consulta', async () => {
    const { stdout } = await run(BIN, ['--print-inputs']);
    const { inputs } = JSON.parse(stdout) as { inputs: Array<Record<string, unknown>> };
    expect(Array.isArray(inputs)).toBe(true);
    for (const i of inputs) {
      expect(typeof i.id).toBe('string');
      expect(typeof i.name).toBe('string');
      expect(['builtin', 'usb', 'bluetooth', 'aggregate', 'virtual', 'other']).toContain(i.transport);
      expect(typeof i.isDefault).toBe('boolean');
      expect(typeof i.inUse).toBe('boolean');
    }
    expect(inputs.filter((i) => i.isDefault).length).toBeLessThanOrEqual(1);
  });
});

describe('cobertura da janela (--simulate-cover)', () => {
  const item = (number: number, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({ number, layer: 0, alpha: 1, x, y, w, h, ...extra });
  async function cover(window: number, items: object[]): Promise<{ covered: number; onScreen: boolean }> {
    const { stdout } = await run(BIN, ['--simulate-cover', JSON.stringify({ window, items })]);
    return JSON.parse(stdout);
  }

  test('livre: nada à frente', async () => {
    expect(await cover(1, [item(1, 0, 0, 100, 100), item(9, 0, 0, 100, 100)])).toEqual({ covered: 0, onScreen: true }); // a de trás não cobre
  });
  test('metade e total', async () => {
    expect((await cover(2, [item(5, 0, 0, 50, 100), item(2, 0, 0, 100, 100)])).covered).toBe(0.5);
    expect((await cover(2, [item(5, -10, -10, 200, 200), item(2, 0, 0, 100, 100)])).covered).toBe(1);
  });
  test('sobreposição entre as de cima conta uma vez (união)', async () => {
    expect((await cover(3, [item(1, 0, 0, 50, 100), item(2, 25, 0, 50, 100), item(3, 0, 0, 100, 100)])).covered).toBe(0.75);
  });
  test('duas janelas que juntas cobrem tudo', async () => {
    expect((await cover(3, [item(1, 0, 0, 60, 100), item(2, 50, 0, 50, 100), item(3, 0, 0, 100, 100)])).covered).toBe(1);
  });
  test('camada > 0 (PiP, sempre no topo) e translúcidas não contam', async () => {
    expect((await cover(3, [item(1, 0, 0, 100, 100, { layer: 3 }), item(2, 0, 0, 100, 100, { alpha: 0.5 }), item(3, 0, 0, 100, 100)])).covered).toBe(0);
  });
  test('fora da lista (minimizada, oculta, outro Space): fora da tela e 100% coberta', async () => {
    expect(await cover(42, [item(1, 0, 0, 100, 100)])).toEqual({ covered: 1, onScreen: false });
  });
  test('retângulos de outro monitor (coordenadas globais) só contam pela interseção', async () => {
    expect((await cover(2, [item(1, 3440, 198, 1920, 1080), item(2, 3000, 300, 800, 400)])).covered).toBe(0.45); // só x 3440–3800 (360 de 800) está sob a janela do 2º monitor
  });
});

describe('cover-watch (comando do main)', () => {
  test('janela inexistente: 1 Hz de window-cover fora da tela; window 0 para', async () => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines: Array<Record<string, unknown>> = [];
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      for (const l of buf.split('\n').slice(0, -1)) if (l) lines.push(JSON.parse(l));
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    try {
      child.stdin.write('{"cmd":"cover-watch","window":2147000000}\n');
      await new Promise((r) => setTimeout(r, 2500));
      const covers = lines.filter((l) => l.event === 'window-cover');
      expect(covers.length).toBeGreaterThanOrEqual(2);
      expect(covers[0]).toEqual({ event: 'window-cover', window: 2147000000, onScreen: false, covered: 1 });
      child.stdin.write('{"cmd":"cover-watch","window":0}\n');
      await new Promise((r) => setTimeout(r, 300));
      const before = lines.filter((l) => l.event === 'window-cover').length;
      await new Promise((r) => setTimeout(r, 1500));
      expect(lines.filter((l) => l.event === 'window-cover').length).toBe(before); // parado: nenhuma amostra nova
    } finally {
      child.kill();
    }
  });
});
