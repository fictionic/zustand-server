import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'globalThis.IS_SERVER': 'true',
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/tests/setup.ts'],
  },
});
