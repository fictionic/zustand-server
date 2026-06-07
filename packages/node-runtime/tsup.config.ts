import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  // @verso-js/contract is type-only (erased at build); sirv resolves
  // from node_modules at runtime. Neither should be bundled in.
  external: [
    '@verso-js/contract',
    'sirv',
  ],
});
