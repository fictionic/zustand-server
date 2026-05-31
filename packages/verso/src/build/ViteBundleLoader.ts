import type {LinkTag, Script, Stylesheet} from "../core/common/handler/PageHeader";
import { defineMiddleware, type MiddlewareDefinition } from "../core/common/handler/Middleware";
import type {MaybePromise} from "../core/common/util/types";

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

export function createViteBundleLoader(config: ViteBundleLoaderConfig): MiddlewareDefinition<'page'> {
  return defineMiddleware('page', ({ getRoute }) => {
    return {
      getStylesheets: async (next) => {
        const routeName = getRoute().name;
        const globalStylesheets: Stylesheet[] = config.getGlobalStylesheets();
        const routeStylesheets: Stylesheet[] = await config.getRouteStylesheets(routeName);
        return [...globalStylesheets, ...routeStylesheets, ...(await next())];
      },
      getLinkTags: async (next) => {
        const routeName = getRoute().name;
        const routePreloads: LinkTag[] = config.getRouteScriptUrls(routeName)
          .map(makeModulePreload);
        return [...routePreloads, ...await next()];
      },
      getScripts: async (next) => {
        // routes don't get their scripts sent down as script tags on pageload.
        // there's a single entrypoint shared by all routes that does a dynamic import
        // of the matched route's handler. we preload those chunks.
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
