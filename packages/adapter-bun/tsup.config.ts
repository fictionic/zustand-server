import { defineConfig } from 'tsup';

export default defineConfig({
  // two outputs: the build-time `bun()` factory (".") and the runtime `bootBun`
  // ("./runtime"). the emitted production entry imports only "./runtime", so the
  // factory never enters the deployed app's import graph.
  entry: { index: 'src/index.ts', runtime: 'src/runtime.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  // @verso-js/contract is type-only (erased at build); Bun.* are ambient
  // globals. There are no runtime dependencies to bundle.
  external: [
    '@verso-js/contract',
  ],
});
