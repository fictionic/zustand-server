import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'globalThis.IS_SERVER': 'false',
    'globalThis.IS_DEV': 'false',
  },
  test: {
    environment: 'jsdom',
    include: ['src/tests/**/*.test.{ts,tsx}'],
  },
});
