import { defineConfig } from 'vite';
import { verso } from '@verso-js/verso/plugin';
import { bun } from '@verso-js/adapter-bun';

export default defineConfig(async ({ command }) => ({
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            manualChunks: (id: string) => {
              if (id.includes('react')) return 'react';
              if (id.includes('verso')) return 'verso';
            },
          },
        },
      },
    },
  },
  build: {
    minify: command === 'build',
    sourcemap: command === 'serve',
  },
  publicDir: 'public',
  plugins: [
    await verso({
      adapter: bun(),
    }),
  ],
}));
