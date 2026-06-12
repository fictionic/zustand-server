import type {RoutesMap} from "../../build/config";
import {createHandlerChain} from "./handler/chain";
import type {MiddlewareDefinition} from "./handler/Middleware";
import {MiddlewareConfig} from "./handler/MiddlewareConfig";
import type {AnyStandardizedHandler, RouteDirective, RouteHandlerDefinition, RouteHandlerType} from "./handler/RouteHandler";
import {createCtx} from "./handler/RouteHandlerCtx";
import {createRouter} from "./router";
import type {MaybePromise} from "../../util/promise";
import {VersoRequest} from "./VersoRequest";
import {isRedirectStatus} from "./redirect";

// Statuses that must not carry a message body per HTTP (RFC 9110): 1xx, 204, 304.
function statusForbidsBody(code: number): boolean {
  return (code >= 100 && code < 200) || code === 204 || code === 304;
}

export type Resolution = |
  { kind: 'not-found' } |
  { kind: 'error' } |
  {
    kind: 'response';
    routeName: string;
    statusCode: number;
    redirectLocation?: string;
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
      switch (directive.kind) {
        case 'ok':
          return {
            kind: 'response',
            routeName: route.routeName,
            statusCode: 200,
            handler: chain,
          }
        case 'status': {
          const { code, hasBody } = directive;
          if (isRedirectStatus(code)) {
            console.warn(`[verso] status directive used redirect code ${code}; use { kind: 'redirect', location } instead. No Location header will be sent.`);
          }
          let useHandler = hasBody;
          if (useHandler && statusForbidsBody(code)) {
            console.warn(`[verso] status ${code} cannot carry a body; ignoring hasBody: true`);
            useHandler = false;
          }
          return {
            kind: 'response',
            routeName: route.routeName,
            statusCode: code,
            handler: useHandler ? chain : undefined,
          };
        }
        case 'redirect': {
          const { code, location } = directive;
          return {
            kind: 'response',
            routeName: route.routeName,
            statusCode: code,
            redirectLocation: location,
          };
        }
        default:
          throw new Error(`unexpected directive kind ${directive satisfies never}`);
      }
    },
  };
}
