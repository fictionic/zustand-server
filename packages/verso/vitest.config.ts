import { defineConfig } from 'vitest/config';

const shared = {
  include: ['src/tests/**/*.test.{ts,tsx}'],
  setupFiles: ['./src/tests/setup.ts'],
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        define: {
          'globalThis.IS_SERVER': 'true',
        },
        test: {
          ...shared,
          name: 'server',
          environment: 'node',
        },
      },
      {
        define: {
          'globalThis.IS_SERVER': 'false',
        },
        test: {
          ...shared,
          name: 'client',
          environment: 'jsdom',
        },
      },
    ],
  },
});
