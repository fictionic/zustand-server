import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

const runtimeExternal = [
  'vite',
  '@vitejs/plugin-react',
  'react',
  'react-dom',
  'react/jsx-runtime',
  'path-to-regexp',
  'cookie',
  'jiti',
];

export default defineConfig([
  {
    name: 'runtime',
    entry: {
      index: 'src/entries/index.ts',
      config: 'src/entries/config.ts',
      plugin: 'src/entries/plugin.ts',
      build: `src/entries/build.ts`,
      server: 'src/entries/server.ts',
      client: 'src/entries/client.ts',
      testing: 'src/entries/testing.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    dts: true,
    clean: true,
    external: runtimeExternal,
  },
  {
    name: 'cli',
    entry: { cli: 'src/build/cli.ts' },
    outDir: 'dist',
    format: ['esm'],
    dts: false,
    clean: false,
    external: runtimeExternal,
    // Shebang + set globalThis flags before any runtime imports execute,
    // so dist/plugin.js (loaded lazily) sees defined values.
    banner: {
      js: '#!/usr/bin/env node\nglobalThis.IS_SERVER = true; globalThis.IS_DEV = false;',
      // TODO: do we still need those globals here?
    },
    async onSuccess() {
      await chmod(join('dist', 'cli.js'), 0o755);
    },
  },
]);
