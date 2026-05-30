import type {LinkTag, Script, Stylesheet} from "../core/common/handler/PageHeader";
import { defineMiddleware, type MiddlewareDefinition } from "../core/common/handler/Middleware";
import type {MaybePromise} from "../core/common/util/types";

export interface ViteBundleLoaderConfig {
  getRouteStylesheets: (routeName: string) => MaybePromise<Stylesheet[]>;
  getRouteModulePreloadUrls: (routeName: string) => string[];
  getRouteScriptUrls: (routeName: string) => string[];
  globalModulePreloadUrls?: string[];
  globalScripts?: Script[];
}

export function createViteBundleLoader(config: ViteBundleLoaderConfig): MiddlewareDefinition<'page'> {
  return defineMiddleware('page', ({ getRoute }) => {
    return {
      getStylesheets: async (next) => {
        const routeName = getRoute().name;
        const stylesheets: Stylesheet[] = await config.getRouteStylesheets(routeName);
        return [...stylesheets, ...(await next())];
      },
      getLinkTags: async (next) => {
        const routeName = getRoute().name;
        const routePreloads: LinkTag[] = config.getRouteModulePreloadUrls(routeName)
          .map(makeModulePreload);
        const globalPreloads: LinkTag[] = (config.globalModulePreloadUrls ?? [])
          .map(makeModulePreload);
        return [...globalPreloads, ...routePreloads, ...await next()];
      },
      getScripts: async (next) => {
        const routeName = getRoute().name;
        const routeScripts: Script[] = config.getRouteScriptUrls(routeName)
          .map(src => ({ src, type: 'module', async: true }));
          // ^async here is important. allows scripts to execute before the document has been parsed.
        const globalScripts: Script[] = config.globalScripts ?? [];
        return [...globalScripts, ...routeScripts, ...await next()];
      },
    };
  });
}

function makeModulePreload(href: string): LinkTag {
  return { rel: 'modulepreload', href };
}
