import { defineConfig } from 'vitest/config';

// Unit tests are pure logic (no rendering, no browser). Playwright e2e specs live in tests/e2e.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    testTimeout: 20000,
  },
});
