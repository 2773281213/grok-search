import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts', 'apps/mcp/src/**/*.test.ts', 'apps/cli/src/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
