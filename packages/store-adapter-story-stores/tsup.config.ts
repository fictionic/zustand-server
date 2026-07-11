import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'story-stores': 'src/story-stores.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'story-stores',
    'story-stores/vanilla',
    'story-stores/react',
    '@verso-js/stores',
    '@verso-js/verso',
  ],
});
