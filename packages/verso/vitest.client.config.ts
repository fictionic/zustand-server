import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'globalThis.IS_SERVER': 'false',
  },
  test: {
    environment: 'jsdom',
    include: ['src/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/tests/setup.ts'],
  },
});
