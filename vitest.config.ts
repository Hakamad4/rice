import { defineConfig } from 'vitest/config';

/**
 * Suítes que dependem de coisas só do macOS/POSIX: executam scripts com `#!` direto (os "falsos" CLIs e helpers em tests/fixtures),
 * `/bin/sh`, `bash`, `chmod`/modos 0700 e o `.command`. No Windows elas não rodam; o equivalente do Windows é coberto por
 * tests/platform/** (simulando `process.platform`) e pelo smoke test (scripts/smoke.mjs) no CI.
 */
const POSIX_ONLY = [
  'tests/ai/agy-sandbox.test.ts',
  'tests/ai/cli-runners.test.ts',
  'tests/ai/factory.test.ts',
  'tests/ai/light.test.ts',
  'tests/ai/model-choice.test.ts',
  'tests/ai/opencode-cli.test.ts',
  'tests/ai/status-cache.test.ts',
  'tests/asr/whisper-server.test.ts',
  'tests/claude/runner.test.ts',
  'tests/session/audio-capture.test.ts',
  'tests/session/detector-client.test.ts',
  'tests/session/notes.test.ts',
  'tests/session/reminders.test.ts',
  'tests/store/permissions.test.ts',
  'tests/warroom/handoff.test.ts',
  'tests/packaging.test.ts', // install.sh, bash
  'tests/native/win-parity.test.ts', // compila o núcleo C++ com `c++`; no CI roda no windows.yml, com RICE_WIN_BIN_DIR
];

/** Precisam de `swift build` dos helpers do Mac (e das dependências em native/third_party, que o CI não tem): só rodam na máquina de desenvolvimento. */
const NEEDS_SWIFT_BUILD = ['tests/native/rice-audio.test.ts', 'tests/native/rice-detector.test.ts'];

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', ...(process.platform === 'win32' ? POSIX_ONLY : []), ...(process.env.CI ? NEEDS_SWIFT_BUILD : [])],
    env: { TZ: 'America/Sao_Paulo' },
    testTimeout: 20_000,
  },
});
