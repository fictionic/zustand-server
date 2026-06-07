import { defineConfig } from 'vitest/config';
import { versoProjects } from './src/entries/testing-config';

export default defineConfig({
  test: {
    projects: versoProjects({
      shared: {
        test: { include: ['src/tests/**/*.test.{ts,tsx}'] },
      },
    }),
  },
});
