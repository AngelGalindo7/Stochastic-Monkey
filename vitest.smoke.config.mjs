import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/smoke/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 30000,
    reporters: ['default'],
  },
});
