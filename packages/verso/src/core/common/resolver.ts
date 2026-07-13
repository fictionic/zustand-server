import type {RoutesMap} from "../../build/config";
import {createHandlerChain} from "./handler/chain";
import type {MiddlewareDefinition} from "./handler/Middleware";
import type {AnyStandardizedHandler, RouteDirective, RouteHandlerDefinition, RouteHandlerType} from "./handler/RouteHandler";
import {createRouter, routeAcceptsMethod, type RouteMatch, type Router} from "./router";
import type {MaybePromise} from "../../util/promise";
import {VersoRequest} from "./VersoRequest";
import {isRedirectStatus} from "./redirect";
import {MAX_RECURSIVE_DEPTH} from "./constants";
import {getRLS} from "./RequestLocalStorage";

// Statuses that must not carry a message body per HTTP (RFC 9110): 1xx, 204, 304.
function statusForbidsBody(code: number): boolean {
  return (code >= 100 && code < 200) || code === 204 || code === 304;
}

const RLS = getRLS<{
  proxyDepth: number;
}>();

export type RouteResolution = |
  { kind: 'not-found' } |
  { kind: 'error' } |
  {
    kind: 'response';
    routeName: string;
    statusCode: number;
    redirectLocation?: string;
    handler?: AnyStandardizedHandler;
  };

export type GetRouteHandler = (routeName: string) => MaybePromise<RouteHandlerDefinition<RouteHandlerType, any, any> | null>;

export class Resolver {
  private router: Router;

  constructor(private routes: RoutesMap, private getRouteHandler: GetRouteHandler, private globalMiddleware: MiddlewareDefinition[]) {
    this.router = createRouter(routes);
  }

  async resolveRoute(req: Request): Promise<RouteResolution> {
    const url = new URL(req.url);
    const route = this.router.matchRoute(url.pathname + url.search, req.method);
    if (!route) {
      return { kind: 'not-found' };
    }
    const versoRequest = new VersoRequest(req);
    RLS().proxyDepth = 1;
    return await this.resolveFromRouteMatch(route, versoRequest);
  }

  private async resolveFromRouteMatch(route: RouteMatch, versoRequest: VersoRequest): Promise<RouteResolution> {
    const { routeName } = route;
    const handler = await this.getRouteHandler(routeName);
    if (!handler) {
      // we don't expect this to happen. this would be a bug in verso.
      console.error(`[verso] no handler for route ${routeName}`);
      return { kind: 'error' };
    }

    const chain = createHandlerChain(handler, versoRequest, route, this.globalMiddleware);

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
      case 'redirect': {
        const { code, location } = directive;
        return {
          kind: 'response',
          routeName: route.routeName,
          statusCode: code,
          redirectLocation: location,
        };
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
      case 'proxy': {
        if (RLS().proxyDepth > MAX_RECURSIVE_DEPTH) {
          console.error('[verso] max proxy depth exceeded!');
          return { kind: 'error' };
        }
        RLS().proxyDepth++;
        const { routeName: proxiedRouteName, routeParams: proxiedRouteParams } = directive;
        if (proxiedRouteName === routeName) {
          console.error(`[verso] a route cannot proxy itself! '${proxiedRouteName}'`);
          return { kind: 'error' };
        }
        const proxiedRouteConfig = this.routes[proxiedRouteName];
        if (!proxiedRouteConfig) {
          console.error(`[verso] proxy route does not exist! '${proxiedRouteName}'`);
          return { kind: 'error' };
        }
        const { method } = versoRequest; // reuse original method
        if (!routeAcceptsMethod(proxiedRouteConfig, method)) {
          console.error(`[verso] proxied route '${proxiedRouteName}' does not handle HTTP method '${method}'`);
          return { kind: 'error' };
        }
        const proxiedRoute: RouteMatch = {
          routeName: proxiedRouteName,
          params: proxiedRouteParams ?? {},
          method,
          handler: proxiedRouteConfig.handler,
        };
        return await this.resolveFromRouteMatch(proxiedRoute, versoRequest);
      }
      default:
        throw new Error(`unexpected directive kind ${directive satisfies never}`);
    }
  }
}
