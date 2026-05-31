import path from 'node:path';
import type {ServerAssets} from "../build/bundle";
import {makeLinkStylesheet, type Script, type Stylesheet} from "../core/common/handler/Page";
import type {MiddlewareDefinition} from "../core/common/handler/Middleware";
import {createViteBundleLoader, makeAsyncScript} from "./ViteBundleLoader";
import type {RoutesMap, ServerSettings} from './config';
import type {RouteHandlerDefinition} from "../core/common/handler/RouteHandler";
import {createResolver, type GetRouteHandler} from "../core/common/resolver";
import {BUILT_STATIC_DIRNAME, CLIENT_BUNDLE_URL_PREFIX, clientAssetUrlToPath, MANIFEST_URL} from "./constants";
import {type HandleRequest, makeHandleRequest} from "../core/server/handleRequest";
import type {RequestHandler} from "../vendor/hattip/compose";

export interface VersoServer {
  serve: HandleRequest;
}

type RouteHandlers = {
  [routeName: string]: RouteHandlerDefinition<any, any, any>;
};

export async function buildServer(
  routes: RoutesMap,
  routeHandlers: RouteHandlers,
  middleware: MiddlewareDefinition[],
  serverAssets: ServerAssets,
  serverSettings: ServerSettings,
): Promise<VersoServer> {
  const { manifest, loadBundle, runDir } = serverAssets;

  // first create the resolver
  const globalScripts: Script[] = manifest.global.scripts.map(makeAsyncScript);
  const globalStylesheets: Stylesheet[] = manifest.global.stylesheets.map(makeLinkStylesheet);
  const routeScriptUrls: Record<string, string[]> = {};
  const routeStylesheets: Record<string, Stylesheet[]> = {};
  for (const [routeName, assets] of Object.entries(manifest.routes)) {
    routeScriptUrls[routeName] = assets.scripts ?? [];
    routeStylesheets[routeName] = assets.stylesheets.map(makeLinkStylesheet);
  }

  const bundleLoader = createViteBundleLoader({
    getGlobalScripts: () => globalScripts,
    getGlobalModulePreloadUrls: () => [MANIFEST_URL],
    // ^global preload for the manifest itself, for client transition css
    // (so the dynamic import() from bootstrap() will be instant)
    getGlobalStylesheets: () => globalStylesheets,
    getRouteScriptUrls: (routeName) => routeScriptUrls[routeName] ?? [],
    getRouteStylesheets: (routeName) => routeStylesheets[routeName] ?? [],
  });

  // systemMiddleware has to come first, so bundles are fetched before any userland assets
  const systemMiddleware = [bundleLoader];
  const globalMiddleware = [...systemMiddleware, ...middleware];
  const getRouteHandler: GetRouteHandler = (routeName: string) => routeHandlers[routeName] ?? null;

  const resolver = createResolver(routes, getRouteHandler, globalMiddleware);

  // then create the bundle serving endpoint
  const serveBundles: RequestHandler = async (ctx) => {
    if (ctx.url.pathname.startsWith(CLIENT_BUNDLE_URL_PREFIX)) {
      const basename = clientAssetUrlToPath(ctx.url.pathname);
      const contents = await loadBundle(basename);
      if (!contents) return notFound();
      const contentType = basename.endsWith('.css') ? 'text/css' : 'application/javascript'; // TODO: nonstandard css extensions, like LESS and SASS?
      // @ts-expect-error -- bogus error: lib.dom.d.ts defines BufferSource as ArrayBufferView<ArrayBuffer>, but undici (Node's actual Response impl) accepts ArrayBufferLike
      return new Response(contents, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable', // chunks are content-hashed
        },
      });
    }
  }

  // in build mode we copy static content into <outDir>/static and serve from there
  const { staticDir } = serverSettings;
  const resolvedStaticDir = staticDir ? path.resolve(runDir, BUILT_STATIC_DIRNAME) : null;

  const handleRequest = makeHandleRequest({
    resolver,
    serveInternalAssets: serveBundles,
    resolvedStaticDir,
    settings: serverSettings,
  });

  return {
    serve: handleRequest,
  };
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

export type BuildServer = typeof buildServer;
