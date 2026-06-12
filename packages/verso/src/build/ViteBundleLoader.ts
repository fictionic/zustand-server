import type {LinkTag, Script, Stylesheet} from "../core/common/handler/PageHeader";
import { defineMiddleware, type MiddlewareDefinition } from "../core/common/handler/Middleware";
import type {MaybePromise} from "../util/promise";
import { getRLS } from "../core/common/RequestLocalStorage";

export interface ViteBundleLoaderConfig {
  /**
   * JS chunks needed for every route (always inclues the shared client entrypoint)
   */
  getGlobalScripts: () => Script[];
  /**
   * Any CSS needed in every route
   */
  getGlobalStylesheets: () => Stylesheet[];
  /**
   * JS chunk URLs per route. Will be modulepreloaded during server render,
   * as it's the first thing the client entrypoint imports.
   */
  getRouteScriptUrls: (routeName: string) => string[];
  /**
   * CSS per route.
   */
  getRouteStylesheets: (routeName: string) => MaybePromise<Stylesheet[]>;
}

const RLS = getRLS<{
  routeNames: string[],
}>();

export function createViteBundleLoader(config: ViteBundleLoaderConfig): MiddlewareDefinition<'page'> {
  return defineMiddleware('page', ({ getRoute }) => {
    // we might get instantiated multiple times during a single request,
    // if a route proxies other routes (and if those routes also proxy).
    // all encountered routes will need to be able to execute clientside,
    // for getRouteDirective, so we'll need to preload their JS chunks.
    // but only the final route will render, so we can ignore CSS assets
    // for all prior routes.
    // (this init function will get run for each route in the proxy chain,
    // but the get* methods will only get run for the final route.)
    if (!RLS().routeNames) {
      RLS().routeNames = [];
    }
    const currentRouteName = getRoute().name;
    RLS().routeNames.push(currentRouteName);
    return {
      // css for the page we'll be rendering
      getStylesheets: async (next) => {
        const globalStylesheets: Stylesheet[] = config.getGlobalStylesheets();
        const routeStylesheets: Stylesheet[] = await config.getRouteStylesheets(currentRouteName);
        return [...globalStylesheets, ...routeStylesheets, ...(await next())];
      },
      // js preloads for all the routes in the proxy chain
      getLinkTags: async (next) => {
        const routePreloads: LinkTag[] = [
          ...new Set(RLS().routeNames.flatMap(r => config.getRouteScriptUrls(r)))
        ].map(makeModulePreload)
        return [...routePreloads, ...await next()];
      },
      // js chunks for the single unified client entrypoint
      getScripts: async (next) => {
        const globalScripts: Script[] = config.getGlobalScripts()
        return [...globalScripts, ...await next()];
      },
    };
  });
}

export function makeAsyncScript(src: string): Script {
  return { src, type: 'module', async: true };
  // ^async here is important. allows scripts to execute before the document has been parsed.
}

function makeModulePreload(href: string): LinkTag {
  return { rel: 'modulepreload', href };
}
