import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'tsup';

const runtimeExternal = [
  'vite',
  'vitest',
  'vitest/config',
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
      testing: 'src/entries/testing.ts',
      'testing-config': 'src/entries/testing-config.ts',
      'testing-setup': 'src/entries/testing-setup.ts',
      // these are needed for the userland build
      build: `src/entries/build.ts`,
      server: 'src/entries/server.ts',
      client: 'src/entries/client.ts',
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
    external: runtimeExternal, // TODO: needed?
    banner: {
      js: '#!/usr/bin/env node',
    },
    async onSuccess() {
      await chmod(join('dist', 'cli.js'), 0o755);
    },
  },
]);
