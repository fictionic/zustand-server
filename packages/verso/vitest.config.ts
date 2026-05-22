import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    'globalThis.IS_SERVER': 'true',
    'globalThis.IS_DEV': 'false',
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{ts,tsx}'],
  },
});
