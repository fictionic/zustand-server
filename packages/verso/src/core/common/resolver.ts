import type {RoutesMap} from "../../build/config";
import {createHandlerChain} from "./handler/chain";
import type {MiddlewareDefinition} from "./handler/Middleware";
import {MiddlewareConfig} from "./handler/MiddlewareConfig";
import type {AnyStandardizedHandler, RouteDirective, RouteHandlerDefinition, RouteHandlerType} from "./handler/RouteHandler";
import {createCtx} from "./handler/RouteHandlerCtx";
import {createRouter} from "./router";
import type {MaybePromise} from "./util/types";
import {VersoRequest} from "./VersoRequest";

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

export type Resolution = |
  { kind: 'not-found' } |
  { kind: 'error' } |
  {
    kind: 'directive';
    routeName: string;
    status: number;
    location?: string;
    handler?: AnyStandardizedHandler;
  };

export interface Resolver {
  resolve: (req: Request) => Promise<Resolution>;
}

export type GetRouteHandler = (routeName: string) => MaybePromise<RouteHandlerDefinition<RouteHandlerType, any, any> | null>;

export function createResolver(routes: RoutesMap, getRouteHandler: GetRouteHandler, globalMiddleware: MiddlewareDefinition[]): Resolver {
  const router = createRouter(routes);
  return {
    resolve: async (req): Promise<Resolution> => {
      const url = new URL(req.url);
      const route = router.matchRoute(url.pathname + url.search, req.method);
      if (!route) {
        return { kind: 'not-found' };
      }
      const { routeName } = route;
      const handler = await getRouteHandler(routeName);
      if (!handler) {
        console.error(`[verso] no handler for route ${routeName}`);
        return { kind: 'error' };
      }
      const versoRequest = new VersoRequest(req);
      const config = new MiddlewareConfig();
      const ctx = createCtx(config, versoRequest, route);
      const chain = createHandlerChain(handler, globalMiddleware, config, ctx);

      let directive: RouteDirective;
      try {
        directive = await chain.getRouteDirective();
      } catch (err) {
        console.error('[verso] error during getRouteDirective', err);
        return { kind: 'error' };
      }
      const { status, location: locationDirective, hasDocument } = directive;
      // (just avoiding creating a variable named 'location')
      const wantsRedirect = REDIRECT_STATUSES.includes(status);
      const useLocation = wantsRedirect && locationDirective;
      if (wantsRedirect && !locationDirective) {
        console.warn("[verso] cannot redirect with empty location!");
      }
      const is2XX = ((status / 100)|0) === 2;
      const useHandler = handler.type === 'endpoint' || is2XX || hasDocument;
      return {
        kind: 'directive',
        routeName: route.routeName,
        status,
        location: useLocation ? locationDirective : undefined,
        handler: useHandler ? chain : undefined,
      };
    },
  };
}
