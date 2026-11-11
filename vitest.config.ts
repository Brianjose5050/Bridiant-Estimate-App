import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/test/**/*.test.ts', 'content/**/test/**/*.test.ts'],
    passWithNoTests: false,
  },
});
