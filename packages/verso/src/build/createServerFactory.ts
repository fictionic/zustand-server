import type {RouteHandlerDefinition} from "../core/common/handler/RouteHandler";
import type {MiddlewareDefinition} from "../entries";
import type {RoutesMap, ServerSettings} from "./config";
import {makeLinkStylesheet, type Script, type Stylesheet} from "../core/common/handler/Page";
import {createViteBundleLoader, makeAsyncScript} from "./ViteBundleLoader";
import {createResolver, type GetRouteHandler} from "../core/common/resolver";
import {CLIENT_BUNDLE_URL_PREFIX, clientAssetUrlToPath} from "./constants";
import type {RequestHandler} from "../vendor/hattip/compose";
import {createVersoServer, type VersoServer} from "../core/server/createVersoServer";
import type {ClientManifest} from "./manifest";

export type ServerRuntime = {
  manifest: ClientManifest;
  loadBundle: (bundleBasename: string) => Promise<Uint8Array | null>;
  serveStatic: RequestHandler;
};

export type ServerFactory = (runtime: ServerRuntime) => VersoServer;

type CreateServerFactoryOpts = {
  routes: RoutesMap,
  middleware: MiddlewareDefinition[],
  routeHandlers: {
    [routeName: string]: RouteHandlerDefinition<any, any, any>;
  },
  settings: ServerSettings,
};

export function createServerFactory({
  routes,
  middleware,
  routeHandlers,
  settings,
}: CreateServerFactoryOpts): ServerFactory {
  return (runtime: ServerRuntime): VersoServer => {
    // first create the resolver
    const { manifest } = runtime;
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
    const { loadBundle } = runtime;
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

    // then get the static serving handler from the runtime
    const { serveStatic } = runtime;

    // now we can wire it all together
    return createVersoServer({
      resolver,
      manifest,
      serveInternal: serveBundles,
      serveStatic,
      settings,
    });
  }
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}
