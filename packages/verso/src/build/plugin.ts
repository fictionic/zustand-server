import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { isRunnableDevEnvironment, normalizePath, type ModuleNode, type Plugin, type ViteDevServer } from 'vite';
import { fillServerSettings, type RoutesMap, type VersoConfig } from './config';
import type { RouteHandler } from '../core/common/handler/RouteHandler';
import type { Script, Stylesheet } from '../core/common/handler/Page';
import type { BundleManifest } from './bundle';
import { BUNDLES_DIR, MANIFEST_PATH, SERVER_BUNDLES_DIR, SERVER_ENTRY_PATH } from './constants';
import { DEV_ROUTE_CSS_PATH } from '../core/common/constants';
import { createViteBundleLoader } from './ViteBundleLoader';
import { toURL, toWebRequest, sendWebResponse } from './node-utils';
import { getEntrypointGenerator, type EntrypointGenerator } from './entrypoint';
import { createJiti, type Jiti } from 'jiti';
import { html500 } from '../core/server/errorPages';
import type {MakeHandleRequest} from '../core/server/handleRequest';
import type { MiddlewareDefinition } from '../core/common/handler/Middleware';
import {createResolver} from '../core/common/resolver';

const VERSO_CONFIG_FILE_NAME = 'verso.config.ts';

const VERSO_DIST_ROOT = path.dirname(fileURLToPath(import.meta.url)); // we are running from dist/plugin.js

// some modules we have to import dynamically through the vite module graph
const SERVER_PATH = path.resolve(VERSO_DIST_ROOT, 'server.js');

const CLIENT_ENTRY_VIRTUAL_ID = 'virtual:verso/entry';
const CLIENT_ENTRY_RESOLVED_ID = '\0' + CLIENT_ENTRY_VIRTUAL_ID;

const SERVER_ENTRY_VIRTUAL_ID = 'virtual:verso/server-entry';
const SERVER_ENTRY_RESOLVED_ID = '\0' + SERVER_ENTRY_VIRTUAL_ID;

const VERSO_PACKAGES = [
  // packages that use IS_SERVER or RequestLocalStorage
  '@verso-js/verso',
  '@verso-js/stores',
];

export default async function verso(configPathOverride?: string): Promise<Plugin[]> {

  // first load verso.config.ts
  const versoConfigPath = configPathOverride ?? path.resolve(process.cwd(), VERSO_CONFIG_FILE_NAME);
  const versoConfig = await importWithJiti<VersoConfig>(versoConfigPath);

  // populated in configResolved
  let resolvedRootDir: string | null = null;
  let resolvedOutDir: string | null = null;
  let entrypointGenerator: EntrypointGenerator | null = null;

  // populated lazily in buildStart / configureServer
  let manifestKeyToRouteName: Record<string, string> = {};
  let routeNameToHandlerPath: Record<string, string> = {};
  let handlersResolved = false;

  type ResolveFn = (path: string) => Promise<{ id: string } | null>;
  async function resolveHandlers(
    routes: RoutesMap,
    rootDir: string,
    resolve: ResolveFn,
  ) {
    if (handlersResolved) return;
    for (const [routeName, routeConfig] of Object.entries(routes)) {
      const absInput = path.resolve(rootDir, routeConfig.handler);
      const result = await resolve(absInput);
      if (!result) {
        throw new Error(
          `[verso] Could not resolve handler for route "${routeName}": ${routeConfig.handler}\n` +
            `  resolved against vite root: ${rootDir}\n` +
            `  attempted absolute path: ${absInput}`
        );
      }
      const resolvedPath = cleanUrl(result.id);
      const manifestKey = normalizePath(path.relative(rootDir, resolvedPath));
      manifestKeyToRouteName[manifestKey] = routeName;
      routeNameToHandlerPath[routeName] = resolvedPath;
    }
    handlersResolved = true;
  }

  return [
    // React plugin must be at the top level (not returned from a config hook)
    // so Vite registers its resolveId/load filters for /@react-refresh.
    // TODO: should we let consumers declare this on their own, in case they don't want it?
    // (this might make it harder to inject the react preamble)
    ...react(),

    {
      name: '@verso-js/verso:core',

      async config(_viteUserConfig, env) {

        const isDev = env.command === 'serve';

        return {
          appType: isDev ? 'custom' : undefined,
          resolve: {
            dedupe: ['react', 'react-dom'],
          },
          define: {
            'IS_DEV': isDev,
            'globalThis.IS_DEV': isDev,
          },
          environments: {
            client: {
              define: {
                'IS_SERVER': false,
                'globalThis.IS_SERVER': false,
                ...( isDev ? {} : { '__BUILD_ID__': new Date().getTime(), } ),
              },
              build: {
                manifest: true,
                emptyOutDir: true,
                rolldownOptions: {
                  input: CLIENT_ENTRY_VIRTUAL_ID,
                  output: {
                    format: 'es' as const,
                    entryFileNames: `${BUNDLES_DIR}/[name]-[hash].js`,
                    chunkFileNames: `${BUNDLES_DIR}/[name]-[hash].js`,
                    assetFileNames: `${BUNDLES_DIR}/[name]-[hash][extname]`,
                  },
                },
              },
            },
            ssr: {
              define: {
                IS_SERVER: true,
                'globalThis.IS_SERVER': true,
              },
              resolve: {
                noExternal: [...VERSO_PACKAGES],
              },
              build: {
                manifest: false,
                emptyOutDir: false,
                rolldownOptions: {
                  input: SERVER_ENTRY_VIRTUAL_ID,
                  output: {
                    format: 'es' as const,
                    entryFileNames: SERVER_ENTRY_PATH,
                    chunkFileNames: `${SERVER_BUNDLES_DIR}/chunks/[name]-[hash].js`,
                  },
                },
              },
            },
          },
          builder: {}, // without this, `vite build` only builds the client env
        };
      },

      async configResolved(config) {
        if (config.base !== '/') {
          throw new Error(`[verso] base !== '/' is not supported (got ${JSON.stringify(config.base)}). Verso assumes a root deployment.`);
        }
        resolvedRootDir = config.root; // the user might have set a custom root dir
        resolvedOutDir = path.resolve(config.root, config.build.outDir);
        entrypointGenerator = getEntrypointGenerator(resolvedRootDir, versoConfig, config.command === 'build');
      },

      async buildStart() {
        await resolveHandlers(
          versoConfig.routes,
          resolvedRootDir!,
          async (id) => await this.resolve(id),
        );
      },

      resolveId(id) {
        switch (id) {
          case CLIENT_ENTRY_VIRTUAL_ID:
            return CLIENT_ENTRY_RESOLVED_ID;
          case SERVER_ENTRY_VIRTUAL_ID:
            return SERVER_ENTRY_RESOLVED_ID;
          default:
            return null;
        }
      },

      async load(id) {
        if (id === CLIENT_ENTRY_RESOLVED_ID) {
          return entrypointGenerator!.generateClientEntrypoint();
        }
        if (id === SERVER_ENTRY_RESOLVED_ID) {
          return entrypointGenerator!.generateServerEntrypoint();
        }
      },

      async writeBundle(_options, bundle) {
        // Only emit manifest during client build
        if (this.environment.name !== 'client') return;

        // Parse Vite's built-in manifest (has transitive CSS + import chains)
        const viteManifestAsset = bundle['.vite/manifest.json'];
        if (!viteManifestAsset || viteManifestAsset.type !== 'asset') {
          throw new Error('[verso] Vite manifest not found; ensure build.manifest is enabled');
        }
        const viteManifest: Record<string, ViteManifestEntry> = JSON.parse(
          typeof viteManifestAsset.source === 'string'
            ? viteManifestAsset.source
            : new TextDecoder().decode(viteManifestAsset.source)
        );

        // Find the entry and resolve its transitive imports (deps first, entry last)
        let entryKey: string | undefined;
        for (const [key, entry] of Object.entries(viteManifest)) {
          if (entry.isEntry) { entryKey = key; break; }
        }
        if (!entryKey) throw new Error('[verso] Entry chunk not found in Vite manifest');
        const entryScripts = resolveImportFiles(entryKey, viteManifest);
        const entryScriptSet = new Set(entryScripts);
        const entryCss = viteManifest[entryKey]!.css ?? [];

        // Match dynamic entries to routes via manifest keys (root-relative, forward-slash)
        const routeManifestKeys: Record<string, string> = {};
        for (const [key, entry] of Object.entries(viteManifest)) {
          if (!entry.isDynamicEntry) continue;
          const routeName = manifestKeyToRouteName[key];
          if (routeName) {
            routeManifestKeys[routeName] = key;
          }
        }

        // Build verso manifest from Vite's
        const manifest: BundleManifest = {};
        for (const routeName of Object.keys(versoConfig.routes)) {
          const routeKey = routeManifestKeys[routeName];
          const routeEntry = routeKey ? viteManifest[routeKey] : undefined;

          // Preloads: route chunk + transitive deps, minus entry scripts
          const preloads = routeKey
            ? resolveImportFiles(routeKey, viteManifest).filter(f => !entryScriptSet.has(f))
            : [];

          // Stylesheets: entry CSS + route CSS, deduped (both already transitive)
          const routeCss = routeEntry?.css ?? [];
          const stylesheets = [...new Set([...entryCss, ...routeCss])];

          manifest[routeName] = { scripts: entryScripts, preloads, stylesheets };
        }

        // Write manifest to disk
        const manifestJson = JSON.stringify(manifest, null, 2);
        const manifestPath = path.join(resolvedOutDir!, MANIFEST_PATH);
        await writeFile(manifestPath, `export default ${manifestJson}`);
      },
    },

    {
      name: '@verso-js/verso:dev-server',
      apply: 'serve',

      async configureServer(vite: ViteDevServer) {
        await resolveHandlers(
          versoConfig.routes,
          resolvedRootDir!,
          (id) => vite.environments.ssr.pluginContainer.resolveId(id),
        );

        const serverSettings = fillServerSettings(versoConfig.server);

        const { routes } = versoConfig;

        const entryUrl = `/@id/__x00__${CLIENT_ENTRY_VIRTUAL_ID}`;

        const makeHandleRequest = await importWithVite<MakeHandleRequest>(vite, SERVER_PATH);

        const routeScripts: Record<string, string[]> = {};
        for (const routeName of Object.keys(routes)) {
          routeScripts[routeName] = [entryUrl];
        }
        const viteDevScripts: Script[] = [
          { text: react.preambleCode.replace('__BASE__', '/'), type: 'module' }, // vite react hmr preamble (inline)
          { src: '/@vite/client', type: 'module' }, // vite dev client
        ];
        const bundleLoader = createViteBundleLoader({
          getRouteStylesheets: async (routeName) => {
            const handlerPath = routeNameToHandlerPath[routeName]!;
            return await collectCss(vite, handlerPath);
          },
          getRouteModulePreloadUrls: () => [],
          getRouteScriptUrls: (routeName) => routeScripts[routeName] ?? [],
          globalScripts: viteDevScripts,
        });
        const systemMiddleware = [bundleLoader];

        const siteMiddlewarePaths = versoConfig.middleware ?? [];
        const siteMiddleware = await Promise.all(
          siteMiddlewarePaths.map((modulePath) => importWithVite<MiddlewareDefinition>(vite, modulePath))
        );
        const globalMiddleware: Array<MiddlewareDefinition> = [...systemMiddleware, ...siteMiddleware];

        const getRouteHandler = async (routeName: string) => {
          const resolvedPath = routeNameToHandlerPath[routeName];
          if (!resolvedPath) return null;
          return await importWithVite<RouteHandler<any, any, any>>(vite, resolvedPath);
        };
        const navigator = createResolver(routes, getRouteHandler, globalMiddleware);

        const handleRequest = makeHandleRequest(navigator, serverSettings);

        return () => {
          vite.middlewares.use(async (req, res) => {
            try {
              const url = toURL(req);

              // Dev-only endpoint: return the CSS stylesheet list for a route, so the
              // client can transition stylesheets during programmatic navigation the
              // same way it does in prod (from the bundle manifest).
              if (url.pathname === DEV_ROUTE_CSS_PATH) {
                const routeName = url.searchParams.get('route');
                if (!routeName || !routes[routeName]) {
                  res.statusCode = 404;
                  res.end();
                  return;
                }
                const handlerPath = routeNameToHandlerPath[routeName]!;
                const stylesheets = await collectCss(vite, handlerPath);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ stylesheets }));
                return;
              }

              const request = toWebRequest(req, res, url);
              const response = await handleRequest(request);
              await sendWebResponse(res, response);
            } catch (e) {
              if (res.destroyed || res.writableEnded) {
                return;
              }
              console.error('[verso]', e);
              res.statusCode = 500;
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(html500);
            }
          });
        };
      },
    },
  ];
}

interface ViteManifestEntry {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

/** Walk a manifest entry's import chain, returning output file paths in dependency order (leaves first). */
function resolveImportFiles(
  key: string,
  manifest: Record<string, ViteManifestEntry>,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(key)) return [];
  visited.add(key);
  const entry = manifest[key];
  if (!entry) return [];
  const files: string[] = [];
  for (const imp of entry.imports ?? []) {
    files.push(...resolveImportFiles(imp, manifest, visited));
  }
  files.push(entry.file);
  return files;
}

/**
 * Needed for fetching CSS on client transitions in dev mode.
 *
 * Walk the module graph for a handler and return its transitive CSS as `<link>`-style
 * stylesheets. Each stylesheet points at Vite's raw-CSS endpoint (`?direct`), and
 * carries the Vite module id as a data attribute so the client can reconcile link
 * tags against Vite's own `<style data-vite-dev-id>` injections during transitions.
 */
export async function collectCss(vite: ViteDevServer, handlerPath: string): Promise<Stylesheet[]> {
  // ensure the handler module graph is populated before walking it
  await getSSRRunner(vite).import(handlerPath);
  const rootNode = await vite.moduleGraph.getModuleByUrl(handlerPath);
  if (!rootNode) return [];

  const visited = new Set<string>();
  const cssNodes: ModuleNode[] = [];

  function walk(node: ModuleNode) {
    if (!node.id || visited.has(node.id)) return;
    visited.add(node.id);
    if (node.file?.endsWith('.css')) {
      // TODO: what about CSS frameworks like LESS that use different extensions?
      cssNodes.push(node);
      return;
    }
    for (const imported of node.importedModules) {
      walk(imported);
    }
  }

  walk(rootNode);

  return cssNodes.map((node) => ({
    href: appendQuery(node.url, 'direct'),
    dataAttr: { name: 'data-vite-dev-id', value: node.id! },
  }));
}

function appendQuery(url: string, param: string): string {
  return url.includes('?') ? `${url}&${param}` : `${url}?${param}`;
}

// for importing modules without a vite dev server.
// only needed for loading the verso config file
let jiti: Jiti;
async function importWithJiti<T>(modulePath: string): Promise<T> {
  if (!jiti) jiti = createJiti(import.meta.url);
  return await importWith(jiti.import.bind(jiti), modulePath);
}

async function importWithVite<T>(vite: ViteDevServer, modulePath: string): Promise<T> {
  const runner = getSSRRunner(vite);
  return await importWith((id) => runner.import(id), modulePath);
}

function getSSRRunner(vite: ViteDevServer) {
  const ssrEnv = vite.environments.ssr;
  if (!isRunnableDevEnvironment(ssrEnv)) {
    throw new Error('[verso] SSR environment is not runnable. Verso requires a runnable SSR environment for dev.');
  }
  return ssrEnv.runner;
}

async function importWith<T>(importer: (modulePath: string) => Promise<any>, modulePath: string): Promise<T> {
  const module = await importer(modulePath);
  const defaultExport = module.default as T;
  if (!defaultExport) {
    throw new Error(`no default export found when importing ${modulePath}`);
  }
  return defaultExport;
}

// mirrors Vite's internal `cleanUrl` -- strip `?query` and `#hash` from a module id
function cleanUrl(id: string): string {
  return id.replace(/[?#].*$/, '');
}
