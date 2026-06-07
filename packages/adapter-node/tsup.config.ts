import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  // @verso-js/contract is type-only (erased at build). adapter-node
  // emits an entry that imports @verso-js/node-runtime as text, so nothing of
  // it is bundled in here either.
  external: [
    '@verso-js/contract',
  ],
});
