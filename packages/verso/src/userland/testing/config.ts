import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, mergeConfig, type ViteUserConfig } from 'vitest/config';

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

// A filename-suffix convention selects which pass(es) a file runs in, so each
// pass collects only its own files (no empty files, no cross-pass reruns):
//   *.server.test.*    server pass only
//   *.client.test.*    client pass only
//   *.hydration.test.* hydration pass only (testHydration)
//   *.test.*           server + client (isomorphic); use serverSide()/clientSide()
//                      for env-specific blocks within an otherwise-isomorphic file.
const HYDRATION_TESTS = '**/*.hydration.test.{ts,tsx}';
const SERVER_ONLY_TESTS = '**/*.server.test.{ts,tsx}';
const CLIENT_ONLY_TESTS = '**/*.client.test.{ts,tsx}';

/**
 * Drop `test.include` from a config so a project can set its own include without
 * vitest's `mergeConfig` *concatenating* the two (which would re-collect every
 * file). Used to keep the broad shared include off the hydration project.
 */
function withoutInclude(cfg: ViteUserConfig): ViteUserConfig {
  if (!cfg.test?.include) return cfg;
  const { include: _drop, ...test } = cfg.test;
  return { ...cfg, test };
}

/**
 * Build the vitest projects for isomorphic Verso testing: `server` (node),
 * `client` (jsdom), and `hydration` (jsdom, for testHydration()).
 *
 * Spread the result into `test.projects` in your `vitest.config.ts`; a single
 * `vitest run` then runs all three. The active pass is the single source of
 * truth (see pass.ts): each project declares it via `provide`, the setup file
 * applies it, and IS_SERVER is derived from it at runtime.
 *
 * Which pass(es) a file runs in is chosen by its filename suffix (see the
 * convention above): the server/client projects share the broad `include` but
 * exclude the suffixes that don't belong to them, and the hydration project
 * collects *only* `*.hydration.test.*`. serverSide()/clientSide() remain for
 * env-specific blocks inside a plain `*.test.*` file.
 *
 * Pass `shared` for plugins/aliases/includes that apply to all projects, and
 * `server`/`client`/`hydration` for per-project escape hatches. Everything
 * merges via vitest's `mergeConfig`, so arrays (plugins, setupFiles) concatenate.
 */
export function versoProjects(opts: VersoProjectsOptions = {}): ViteUserConfig[] {
  const { shared = {}, server = {}, client = {}, hydration = {} } = opts;

  // passWithNoTests: a consumer may legitimately have no files for a given pass
  // (e.g. no *.hydration.test.* yet). That's expected, not an error.
  const serverBase: ViteUserConfig = {
    test: {
      name: 'server',
      environment: 'node',
      setupFiles: [setupFile],
      provide: { versoPass: 'server' },
      passWithNoTests: true,
      exclude: [...configDefaults.exclude, CLIENT_ONLY_TESTS, HYDRATION_TESTS],
    },
  };
  const clientBase: ViteUserConfig = {
    test: {
      name: 'client',
      environment: 'jsdom',
      setupFiles: [setupFile],
      provide: { versoPass: 'client' },
      passWithNoTests: true,
      exclude: [...configDefaults.exclude, SERVER_ONLY_TESTS, HYDRATION_TESTS],
    },
  };
  const hydrationBase: ViteUserConfig = {
    test: {
      name: 'hydration',
      environment: 'jsdom',
      setupFiles: [setupFile],
      provide: { versoPass: 'hydration' },
      passWithNoTests: true,
      include: [HYDRATION_TESTS],
      exclude: [...configDefaults.exclude],
    },
  };

  return [
    mergeConfig(mergeConfig(serverBase, shared), server),
    mergeConfig(mergeConfig(clientBase, shared), client),
    // strip the broad shared include so the hydration project keeps its narrow one
    mergeConfig(mergeConfig(hydrationBase, withoutInclude(shared)), hydration),
  ];
}
