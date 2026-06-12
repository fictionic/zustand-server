import type {SharedMethods, BaseResponder, RouteHandlerType} from "./RouteHandler";
import type {BaseConfig} from "./MiddlewareConfig";
import type {PageOptionalMethods, PageRequiredMethods} from "./Page";
import type {EndpointRequiredMethods} from "./Endpoint";
import type {RouteHandlerCtx} from "./RouteHandlerCtx";

type HandlerMethodsMap = {
  page: PageOptionalMethods & PageRequiredMethods;
  endpoint: EndpointRequiredMethods;
  all: {};
};

type HandlerMethodsFor<S extends Scope> = HandlerMethodsMap[S];

type AllHandlerMethodKeys = {
  [S in keyof HandlerMethodsMap]: keyof HandlerMethodsMap[S]
}[keyof HandlerMethodsMap];

type ForbiddenMethodsMap = {
  [S in Scope]: {
    [K in AllHandlerMethodKeys as K extends keyof HandlerMethodsMap[S] ? never : K]?: never
  }
};

export type Scope = RouteHandlerType | 'all';

interface MiddlewareHooks<C extends BaseConfig> {
  addConfigValues(): C;
}

export type Middleware<S extends Scope, C extends BaseConfig> =
  ForbiddenMethodsMap[S] &
  Partial<
    BaseResponder<S> &
    MiddlewareHooks<C> &
    Chained<SharedMethods> &
    Chained<HandlerMethodsFor<S>>
  >;

type MiddlewareInit<S extends Scope, C extends BaseConfig> = (ctx: RouteHandlerCtx) => Middleware<S, C>;

export interface MiddlewareDefinition<S extends Scope = Scope, C extends BaseConfig = BaseConfig> {
  type: 'middleware';
  scope: S;
  init: MiddlewareInit<S, C>;
}

export function defineMiddleware<C extends BaseConfig>(
  init: MiddlewareInit<'page', C>,
): MiddlewareDefinition<'page', C>;

export function defineMiddleware<S extends Scope, C extends BaseConfig>(
  scope: S,
  init: NoInfer<MiddlewareInit<S, C>>,
): MiddlewareDefinition<S, C>;

export function defineMiddleware<S extends Scope, C extends BaseConfig>(
  scopeOrPageInit: S | MiddlewareInit<'page', C>,
  init?: NoInfer<MiddlewareInit<S, C>>,
) {
  if (typeof scopeOrPageInit === 'function') {
    return { type: 'middleware', scope: 'page', init: scopeOrPageInit };
  }
  return { type: 'middleware', scope: scopeOrPageInit, init };
}

type Chained<T> = {
  [K in keyof T]: NonNullable<T[K]> extends (...args: any[]) => infer R
    ? (next: () => R) => R
    : T[K];
};

