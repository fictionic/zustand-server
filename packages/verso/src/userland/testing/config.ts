import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mergeConfig, type ViteUserConfig } from 'vitest/config';

// vitest resolves `setupFiles` via node resolution — it does NOT apply
// resolve.alias and it honors package "exports" (which point at dist). So to let
// Verso run its own tests from source without a build, resolve the setup module
// to an absolute path relative to this one: a sibling `setup.ts` in source, or
// the built `testing-setup.js` in dist.
function resolveSetupFile(): string {
  const source = new URL('./setup.ts', import.meta.url);
  return fileURLToPath(existsSync(source) ? source : new URL('./testing-setup.js', import.meta.url));
}

export interface VersoProjectsOptions {
  /** config applied to all projects (server, client, and hydration) */
  shared?: ViteUserConfig;
  /** extra config for the server (node) project only */
  server?: ViteUserConfig;
  /** extra config for the client (jsdom) project only */
  client?: ViteUserConfig;
  /** extra config for the hydration (jsdom) project only */
  hydration?: ViteUserConfig;
}

const setupFile = resolveSetupFile();

/**
 * Build the vitest projects for isomorphic Verso testing: `server` (node),
 * `client` (jsdom), and `hydration` (jsdom, for testHydration()).
 *
 * Spread the result into `test.projects` in your `vitest.config.ts`; a single
 * `vitest run` then runs all three. The active pass is the single source of
 * truth (see pass.ts): each project declares it via `provide`, the setup file
 * applies it, and IS_SERVER is derived from it at runtime. serverSide(),
 * clientSide(), and testHydration() each run only in their own pass.
 *
 * Pass `shared` for plugins/aliases/includes that apply to all projects, and
 * `server`/`client`/`hydration` for per-project escape hatches. Everything
 * merges via vitest's `mergeConfig`, so arrays (plugins, setupFiles) concatenate.
 */
export function versoProjects(opts: VersoProjectsOptions = {}): ViteUserConfig[] {
  const { shared = {}, server = {}, client = {}, hydration = {} } = opts;

  // passWithNoTests: a file's helpers register no tests in the passes they don't
  // apply to (serverSide in the client pass, etc.), leaving the file empty there.
  // That's expected, not an error — and avoids cluttering output with skips.
  const serverBase: ViteUserConfig = {
    test: {
      name: 'server',
      environment: 'node',
      setupFiles: [setupFile],
      provide: { versoPass: 'server' },
      passWithNoTests: true,
    },
  };
  const clientBase: ViteUserConfig = {
    test: {
      name: 'client',
      environment: 'jsdom',
      setupFiles: [setupFile],
      provide: { versoPass: 'client' },
      passWithNoTests: true,
    },
  };
  const hydrationBase: ViteUserConfig = {
    test: {
      name: 'hydration',
      environment: 'jsdom',
      setupFiles: [setupFile],
      provide: { versoPass: 'hydration' },
      passWithNoTests: true,
    },
  };

  return [
    mergeConfig(mergeConfig(serverBase, shared), server),
    mergeConfig(mergeConfig(clientBase, shared), client),
    mergeConfig(mergeConfig(hydrationBase, shared), hydration),
  ];
}
