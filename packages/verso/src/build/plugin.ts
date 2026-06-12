import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { isRunnableDevEnvironment, normalizePath, type ModuleNode, type Plugin, type ViteDevServer } from 'vite';
import { fillServerSettings, type RoutesMap, type VersoConfig } from './config';
import type { RouteHandler } from '../core/common/handler/RouteHandler';
import type { Script, Stylesheet } from '../core/common/handler/Page';
import {
  BUILT_STATIC_DIRNAME,
  CLIENT_BUNDLE_DIR,
  clientAssetPathToUrl,
  DEFAULT_OUTDIR,
  CLIENT_MANIFEST_FILENAME,
  SERVER_BUNDLE_DIR,
  SERVER_ENTRY_FILENAME,
  VERSO_ENTRY,
  getBuildPaths,
} from './paths';
import { DEV_ROUTE_CSS_PATH } from '../core/common/constants';
import { createEntrypointGenerator, type EntrypointGenerator } from './entrypoint';
import { createJiti, type Jiti } from 'jiti';
import type { MiddlewareDefinition } from '../core/common/handler/Middleware';
import type {RequestHandler} from '../vendor/hattip/compose';
import type {ComposeServer} from '../core/server/composeServer';
import {cpSync, existsSync, rmSync} from 'node:fs';
import { toNodeRequestHandler, createVersoNodeHandler } from "@verso-js/node-runtime";
import { node } from "@verso-js/adapter-node";
import type {BuildAdapter, ClientManifest} from '@verso-js/contract';
import {makeAsyncScript} from './ViteBundleLoader';
import type {DevServerStuff} from '../entries/dev';

const VERSO_CONFIG_FILE_NAME = 'verso.config.ts';

const VERSO_DIST_ROOT = path.dirname(fileURLToPath(import.meta.url)); // we are running from dist/plugin.js

const CLIENT_ENTRY_VIRTUAL_ID = 'virtual:verso/entry';
const CLIENT_ENTRY_RESOLVED_ID = '\0' + CLIENT_ENTRY_VIRTUAL_ID;

const SERVER_ENTRY_VIRTUAL_ID = 'virtual:verso/server-entry';
const SERVER_ENTRY_RESOLVED_ID = '\0' + SERVER_ENTRY_VIRTUAL_ID;

export type PluginOptions = {
  configPath: string
  adapter: BuildAdapter;
};

function fillPluginOptions(o?: Partial<PluginOptions>): PluginOptions {
  return Object.assign({}, getDefaultOptions(), o);
}

function getDefaultOptions(): PluginOptions {
  return {
    // TODO what does cwd resolve to? is it the dir from which the user invokes `vite`,
    // or is it normalized to the vite.config.ts directory?
    configPath: path.resolve(process.cwd(), VERSO_CONFIG_FILE_NAME),
    adapter: node(),
  };
}

export default async function verso(_opts?: Partial<PluginOptions>): Promise<Plugin[]> {
  const opts = fillPluginOptions(_opts);

  // first load verso.config.ts
  const { configPath } = opts;
  const versoConfig = (await importDefaultWithJiti<VersoConfig>(configPath));

  // populated in configResolved
  let resolvedRootDir: string | null = null;
  let resolvedPublicDir: string | null = null;
  let entrypointGenerator: EntrypointGenerator | null = null;
  let resolvedSharedOutDir: string | null = null;

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
          experimental: {
            // Rolldown bakes asset URLs (dynamic imports, CSS preloads) into chunks
            // using `base + outputFilename`. We want files at `client/...` on disk but
            // served under `${CLIENT_BUNDLE_URL_PREFIX}/...`. This hook rewrites every
            // such URL through `clientAssetPathToUrl`, decoupling FS from URL.
            renderBuiltUrl(filename, { ssr }) {
              if (ssr) return; // server bundle is not loaded over HTTP
              return clientAssetPathToUrl(filename);
            },
          },
          environments: {
            client: {
              define: {
                'IS_SERVER': false,
                'globalThis.IS_SERVER': false,
              },
              build: {
                manifest: true,
                rolldownOptions: {
                  input: CLIENT_ENTRY_VIRTUAL_ID,
                  output: {
                    format: 'es' as const,
                    entryFileNames: 'entry-[hash].js',
                    chunkFileNames: 'chunks/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash][extname]',
                  },
                },
              },
            },
            ssr: {
              define: {
                'IS_SERVER': true,
                'globalThis.IS_SERVER': true,
              },
              resolve: {
                noExternal: [
                  // packages that use IS_SERVER or RequestLocalStorage
                  // need to be within the same module graph as userland code
                  '@verso-js/verso',
                  '@verso-js/stores',
                ],
              },
              build: {
                manifest: false,
                rolldownOptions: {
                  input: SERVER_ENTRY_VIRTUAL_ID,
                  output: {
                    format: 'es' as const,
                    entryFileNames: SERVER_ENTRY_FILENAME, // hardcoded so 'preview' can find it
                    chunkFileNames: 'chunks/[name].js', // in case there's bundle splitting server-side
                    assetFileNames: 'assets/[name][extname]', // in case there's server-side assets?
                  },
                },
              },
            },
          },
          builder: {
            async buildApp(builder) {
              await builder.build(builder.environments.client!);
              await builder.build(builder.environments.ssr!);
              const { adapter } = opts;
              await adapter.adapt({
                paths: getBuildPaths(),
                writeEntry: async (contents) => {
                  await writeFile(path.join(resolvedSharedOutDir!, 'index.js'), contents, { mode: 0o755 });
                },
              });
            },
          },
        };
      },

      // all build output goes in <outDir>/.
      // client and server artifacts each get their own subdir.
      // this is achieved by specifying a separate per-env outDir, which
      // we set here.
      // this means they must share a common parent dir, which we enforce
      // in configResolved.
      configEnvironment(name, envConfig) {
        if (name !== 'client' && name !== 'ssr') return;
        const subdir = name === 'client' ? CLIENT_BUNDLE_DIR : SERVER_BUNDLE_DIR;
        const parent = envConfig.build?.outDir ?? DEFAULT_OUTDIR;
        return { build: { outDir: path.join(parent, subdir) } };
      },

      configResolved(config) {
        if (config.base !== '/') {
          throw new Error(`[verso] base !== '/' is not supported (got ${JSON.stringify(config.base)}). Verso assumes a root deployment.`);
        }
        resolvedRootDir = config.root; // the user might have set a custom root dir
        entrypointGenerator = createEntrypointGenerator(resolvedRootDir, versoConfig);

        // enforce that the client and ssr env outDirs are siblings.
        // we need them to share a parent dir so we can colocate them with
        // the copy of the staticDir in build mode
        const clientOutDir = config.environments.client!.build.outDir;
        const ssrOutDir = config.environments.ssr!.build.outDir;
        const clientParent = path.dirname(clientOutDir);
        const ssrParent = path.dirname(ssrOutDir);
        if (clientParent !== ssrParent) {
          throw new Error(
            `[verso] client and ssr build.outDir must share a parent directory. ` +
              `Got:\n  client: ${clientOutDir}\n  ssr:    ${ssrOutDir}`
          );
        }
        resolvedSharedOutDir = clientParent;

        resolvedPublicDir = config.publicDir || null;
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

      /**
       * Write the Verso client manifest using the Vite manifest
       */
      async writeBundle(_options, bundle) {
        if (this.environment.name !== 'client') return;

        // parse Vite's built-in manifest (has transitive CSS + import chains)
        const viteManifestAsset = bundle['.vite/manifest.json'];
        if (!viteManifestAsset || viteManifestAsset.type !== 'asset') {
          throw new Error('[verso] Vite manifest not found; ensure build.manifest is enabled');
        }
        const viteManifest: Record<string, ViteManifestEntry> = JSON.parse(
          typeof viteManifestAsset.source === 'string'
            ? viteManifestAsset.source
            : new TextDecoder().decode(viteManifestAsset.source)
        );

        // find the entry and resolve its transitive imports (deps first, entry last)
        let entryKey: string | undefined;
        for (const [key, entry] of Object.entries(viteManifest)) {
          if (entry.isEntry) { entryKey = key; break; }
        }
        if (!entryKey) throw new Error('[verso] entry chunk not found in Vite manifest');
        const entryScripts = resolveImportFiles(entryKey, viteManifest);
        const entryScriptSet = new Set(entryScripts);
        const entryStylesheets = viteManifest[entryKey]!.css ?? [];
        const entryStylesheetsSet = new Set(entryStylesheets);

        // match dynamic entries to routes via manifest keys (root-relative, forward-slash)
        const routeManifestKeys: Record<string, string> = {};
        for (const [key, entry] of Object.entries(viteManifest)) {
          if (!entry.isDynamicEntry) continue;
          const routeName = manifestKeyToRouteName[key];
          if (routeName) {
            routeManifestKeys[routeName] = key;
          }
        }

        const manifest: ClientManifest = {
          global: {
            scripts: entryScripts.map(clientAssetPathToUrl),
            stylesheets: entryStylesheets.map(clientAssetPathToUrl),
          },
          routes: {
            // we'll fill this in next
          },
        };

        for (const routeName of Object.keys(versoConfig.routes)) {
          const routeKey = routeManifestKeys[routeName];
          const routeEntry = routeKey ? viteManifest[routeKey] : undefined;

          // scripts: route chunk + transitive deps, minus entry scripts
          // (these get modulepreloaded in build mode)
          const scripts = routeKey
            ? resolveImportFiles(routeKey, viteManifest).filter(f => !entryScriptSet.has(f))
            : [];

          // stylesheets: route CSS (already transitive)
          const stylesheets = (routeEntry?.css ?? []).filter(s => !entryStylesheetsSet.has(s));

          manifest.routes[routeName] = {
            scripts: scripts.map(clientAssetPathToUrl),
            stylesheets: stylesheets.map(clientAssetPathToUrl),
          };
        }

        const manifestJson = JSON.stringify(manifest, null, 2);
        const manifestPath = path.join(resolvedSharedOutDir!, CLIENT_MANIFEST_FILENAME);
        await writeFile(manifestPath, `export default ${manifestJson}`);
        console.log("[verso] writing client manifest", manifestPath);
      },

      /**
       * Copy static content into <outDir>/static
       */
      async closeBundle(error) {
        if (error) return;
        if (this.environment.name !== 'client') return;
        if (resolvedPublicDir) {
          const src = path.resolve(resolvedRootDir!, resolvedPublicDir);
          const dest = path.resolve(resolvedSharedOutDir!, BUILT_STATIC_DIRNAME);
          if (!existsSync(src)) {
            console.warn(`[verso] publicDir does not exist! ${resolvedPublicDir}`);
            return;
          }
          rmSync(dest, { recursive: true, force: true });
          cpSync(src, dest, { recursive: true });
        }
      },
    },

    {
      name: '@verso-js/verso:dev-server',
      apply: 'serve', // TODO: needed?

      async configureServer(vite: ViteDevServer) {
        await resolveHandlers(
          versoConfig.routes,
          resolvedRootDir!,
          (id) => vite.environments.ssr.pluginContainer.resolveId(id),
        );

        // have to import verso core through vite, because of RLS
        const devServerStuffEntryPath = path.resolve(VERSO_DIST_ROOT, VERSO_ENTRY.devServerStuff);
        const { createViteBundleLoader, Resolver } = await importDefaultWithVite<DevServerStuff>(vite, devServerStuffEntryPath);

        const entryUrl = `/@id/__x00__${CLIENT_ENTRY_VIRTUAL_ID}`;
        const entryScript = makeAsyncScript(entryUrl); // (except this import is fine)

        const viteDevScripts: Script[] = [
          { text: react.preambleCode.replace('__BASE__', '/'), type: 'module' }, // vite react hmr preamble (inline)
          { src: '/@vite/client', type: 'module' }, // vite dev client
        ];

        const bundleLoader = createViteBundleLoader({
          getGlobalScripts: () => [...viteDevScripts, entryScript],
          getGlobalStylesheets: () => [], // all styles are loaded through the per-route endpoint in dev
          getRouteScriptUrls: () => [], // no bundles in dev
          getRouteStylesheets: async (routeName) => {
            const handlerPath = routeNameToHandlerPath[routeName]!;
            return await collectCss(vite, handlerPath);
          },
        });
        const systemMiddleware = [bundleLoader];

        const siteMiddlewarePaths = versoConfig.middleware ?? [];
        const siteMiddleware = await Promise.all(
          siteMiddlewarePaths.map(async (modulePath) => await importDefaultWithVite<MiddlewareDefinition>(vite, modulePath))
        );
        // systemMiddleware has to come first, so page modules + assets are loaded before any userland assets
        const globalMiddleware: Array<MiddlewareDefinition> = [...systemMiddleware, ...siteMiddleware];

        const getRouteHandler = async (routeName: string) => {
          const resolvedPath = routeNameToHandlerPath[routeName];
          if (!resolvedPath) return null;
          return await importDefaultWithVite<RouteHandler<any, any, any>>(vite, resolvedPath);
        };

        const { routes } = versoConfig;

        const resolver = new Resolver(routes, getRouteHandler, globalMiddleware);

        const serveClientStylesheets: RequestHandler = async (ctx) => {
          // Dev-only endpoint: return the CSS stylesheet list for a route, so the
          // client can transition stylesheets during programmatic navigation the
          // same way it does in build mode (from the client manifest).
          // Note that this includes global stylesheets (those used in every route),
          // unlike in build mode, where those are tracked separately in the manfest.
          if (ctx.url.pathname === DEV_ROUTE_CSS_PATH) {
            const routeName = ctx.url.searchParams.get('route');
            if (!routeName || !routes[routeName]) {
              return new Response(null, { status: 404 });
            }
            const handlerPath = routeNameToHandlerPath[routeName]!;
            const stylesheets = await collectCss(vite, handlerPath);
            return new Response(JSON.stringify({ stylesheets }), {
              headers: {
                'Content-Type': 'application/json'
              },
            });
          }
        };

        const serverSettings = fillServerSettings(versoConfig.server);

        const serverEntryPath = path.resolve(VERSO_DIST_ROOT, VERSO_ENTRY.composeServer);
        const composeServer = await importDefaultWithVite<ComposeServer>(vite, serverEntryPath);

        const versoServer = composeServer({
          resolver,
          manifest: null,
          serveInternal: serveClientStylesheets,
          settings: serverSettings,
          allowLoopbackHosts: true,
        });

        return () => {
          // we have to do a little surgery on the vite middleware stack.
          // vite serves the contents of the root dir, and this can in principle
          // clash with the user's verso routes. the only way to prevent this is to
          // rip out the middleware manually.
          const before = vite.middlewares.stack.length;
          vite.middlewares.stack = vite.middlewares.stack.filter(
            (layer) => (layer.handle as { name?: string }).name !== 'viteServeStaticMiddleware',
          );
          if (vite.middlewares.stack.length === before) {
            console.warn('[verso] failed to remove viteServeStaticMiddleware; filesystem contents may clobber site routes');
          }
          vite.middlewares.use(toNodeRequestHandler(versoServer.serve));
        };
      },
    },

    {
      name: '@verso-js/verso:preview-server',
      async configurePreviewServer(preview): Promise<void> {
        const paths = getBuildPaths();
        const runDir = resolvedSharedOutDir!;
        const handler = await createVersoNodeHandler({
          runDir,
          paths,
          allowLoopbackHosts: true,
        });
        preview.middlewares.use(handler);
        // for the preview server, we don't want _any_ of vite's built-in middleware,
        // so we just call `use()` right away and return void.
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
async function importDefaultWithJiti<T>(modulePath: string): Promise<T> {
  if (!jiti) jiti = createJiti(import.meta.url);
  return await importDefaultWith(jiti.import.bind(jiti), modulePath);
}

async function importDefaultWithVite<T>(vite: ViteDevServer, modulePath: string): Promise<T> {
  const runner = getSSRRunner(vite);
  return await importDefaultWith((id) => runner.import(id), modulePath);
}

function getSSRRunner(vite: ViteDevServer) {
  const ssrEnv = vite.environments.ssr;
  if (!isRunnableDevEnvironment(ssrEnv)) {
    throw new Error('[verso] SSR environment is not runnable. Verso requires a runnable SSR environment for dev.');
  }
  return ssrEnv.runner;
}

async function importDefaultWith<T>(importer: (modulePath: string) => Promise<any>, modulePath: string): Promise<T> {
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
