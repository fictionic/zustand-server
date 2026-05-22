import { defineConfig } from 'vite';
import { verso } from '@verso-js/verso/plugin';

export default defineConfig({
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            manualChunks: (id) => {
              if (id.includes('react')) return 'react';
              if (id.includes('verso')) return 'verso';
            },
          },
        },
      },
    },
  },
  build: {
    minify: false,
  },
  plugins: [
    await verso(),
  ],
});
