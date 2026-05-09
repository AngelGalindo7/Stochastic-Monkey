import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    testTimeout: 10000,
    reporters: ['default'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/browser/lightpanda.js'],
    },
  },
});
