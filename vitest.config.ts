import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: { TZ: 'America/Sao_Paulo' },
    testTimeout: 20_000,
  },
});
