import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/tui/**/*.test.{ts,tsx}'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
