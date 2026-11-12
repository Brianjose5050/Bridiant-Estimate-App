import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'content/**/test/**/*.test.ts', 'apps/server/test/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
