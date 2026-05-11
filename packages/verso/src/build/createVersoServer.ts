import type {BundleResult} from "../build/bundle";
import type {Stylesheet} from "../core/common/handler/Page";
import type {MiddlewareDefinition} from "../core/common/handler/Middleware";
import {createViteBundleLoader} from "./ViteBundleLoader";
import type {RoutesMap, ServerSettings} from './config';
import type {RouteHandlerDefinition} from "../core/common/handler/RouteHandler";
import {createNavigator, type GetRouteHandler} from "../core/common/navigator";
import {MANIFEST_PATH} from "./constants";
import {type HandleRequest, makeHandleRequest} from "../core/server/handleRequest";

export interface VersoServer {
  serve: HandleRequest;
}

type RouteHandlers = {
  [routeName: string]: RouteHandlerDefinition<any, any, any>;
};

export async function createVersoServer(
  routes: RoutesMap,
  routeHandlers: RouteHandlers,
  middleware: MiddlewareDefinition[],
  bundleResult: BundleResult,
  serverSettings: ServerSettings,
): Promise<VersoServer> {
  const bundlesByPath = new Map<string, { contents: string; contentType: string }>();
  const { bundleContents } = bundleResult;
  for (const [bundlePath, contents] of Object.entries(bundleContents)) {
    const isCss = bundlePath.endsWith('.css'); // TODO allow for configuring different css extensions?
    bundlesByPath.set(`/${bundlePath}`, {
      contents,
      contentType: isCss ? 'text/css' : 'application/javascript',
    });
  }

  const { manifest } = bundleResult;

  // Build per-route script/stylesheet/preload maps from the manifest
  const routeScripts: Record<string, string[]> = {};
  const routeStylesheets: Record<string, Stylesheet[]> = {};
  const routePreloadSources: Record<string, string[]> = {};
  for (const [routeName, assets] of Object.entries(manifest)) {
    routeScripts[routeName] = assets.scripts.map(s => `/${s}`);
    routeStylesheets[routeName] = assets.stylesheets.map(s => ({ href: `/${s}` }));
    routePreloadSources[routeName] = (assets.preloads ?? []).map(s => `/${s}`);
  }

  // global preload for the manifest itself, for client transition css
  // (so the dynamic import() from bootstrap() will be instant)
  const manifestUrl = MANIFEST_PATH;

  const bundleLoader = createViteBundleLoader({
    getRouteScriptUrls: (routeName) => routeScripts[routeName] ?? [],
    getRouteStylesheets: (routeName) => routeStylesheets[routeName] ?? [],
    getRouteModulePreloadUrls: (routeName) => routePreloadSources[routeName] ?? [],
    globalModulePreloadUrls: [manifestUrl],
  });

  const systemMiddleware = [bundleLoader];
  const globalMiddleware = [...systemMiddleware, ...middleware];
  const getRouteHandler: GetRouteHandler = (routeName: string) => routeHandlers[routeName] ?? null;
  const navigator = createNavigator(routes, getRouteHandler, globalMiddleware);

  const handleRequest = makeHandleRequest(navigator, serverSettings);

  return {
    serve: (req: Request) => {
      const url = new URL(req.url);

      // Serve client bundles
      const bundle = bundlesByPath.get(url.pathname);
      if (bundle) {
        return Promise.resolve(new Response(bundle.contents, {
          headers: { 'Content-Type': bundle.contentType },
        }));
      }

      return handleRequest(req);
    }
  };
}

export type CreateVersoServer = typeof createVersoServer;
