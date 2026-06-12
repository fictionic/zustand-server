import type {BaseConfig} from "./MiddlewareConfig";
import type {MiddlewareDefinition, Scope} from "./Middleware";
import type {RouteHandlerCtx} from "./RouteHandlerCtx";
import type {MaybePromise} from "../../../util/promise";
import type {RedirectStatusCode} from "../redirect";

export interface HandlerRegistry {}

export type RouteHandlerType = keyof HandlerRegistry;

export type RouteDirective = |
  { kind: 'ok' } |
  {
    kind: 'status',
    code: number;
    hasBody: boolean;
  } |
  {
    kind: 'redirect',
    code: RedirectStatusCode;
    location: string;
  };
  // TODO: proxyRoute?: string;

export interface SharedOptionalMethods {
  getRouteDirective(): MaybePromise<RouteDirective>;
  getHeaders(): Headers;
};

export interface SharedMethods extends Partial<SharedOptionalMethods> {};

export interface SharedHooks {
  setConfigValues(): Partial<BaseConfig>;
};

export interface MiddlewareDepender<S extends Scope> {
  middleware: MiddlewareDefinition<S | 'all'>[];
};

export interface BaseResponder<S extends Scope> extends MiddlewareDepender<S>, SharedHooks {};

export type RouteHandler<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
> = Partial<BaseResponder<T>> &
  SharedMethods &
  Partial<OptionalMethods> &
  RequiredMethods;

type RouteHandlerFor<T extends RouteHandlerType> = RouteHandler<T, {}, {}>;

export type RouteHandlerInit<T extends RouteHandlerType, H extends RouteHandlerFor<T>> = (ctx: RouteHandlerCtx) => H;

export interface RouteHandlerDefinition<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
> {
  type: T;
  init: RouteHandlerInit<T, RouteHandler<T, OptionalMethods, RequiredMethods>>;
  standardize: RouteHandlerStandardizer<T, OptionalMethods, RequiredMethods>;
}

export function defineRouteHandler<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
>(
  type: T,
  init: RouteHandlerInit<T, RouteHandler<T, OptionalMethods, RequiredMethods>>,
  defaults: OptionalMethods,
  requiredNames: (keyof RequiredMethods)[],
): RouteHandlerDefinition<T, OptionalMethods, RequiredMethods> {
  const standardize = makeStandardizer(type, defaults, requiredNames);
  return {
    type,
    init,
    standardize,
  };
}


export type StandardizedRouteHandler<
  T extends RouteHandlerType,
  OptionalMethods extends {},
  RequiredMethods extends {},
> = { type: T } & SharedOptionalMethods & OptionalMethods & RequiredMethods;

export type StandardizedFor<T extends RouteHandlerType> =
  StandardizedRouteHandler<T, HandlerRegistry[T]['optional'], HandlerRegistry[T]['required']>;

export type AnyStandardizedHandler = {
  [T in RouteHandlerType]: StandardizedFor<T>
}[RouteHandlerType];
type RouteHandlerStandardizer<T extends RouteHandlerType, OptionalMethods extends {}, RequiredMethods extends {}> =
  (handler: RouteHandler<T, OptionalMethods, RequiredMethods>) => StandardizedRouteHandler<T, OptionalMethods, RequiredMethods>;

function makeStandardizer<T extends RouteHandlerType, OptionalMethods extends {}, RequiredMethods extends {}>(
  type: T,
  defaults: OptionalMethods,
  requiredNames: (keyof RequiredMethods)[],
): RouteHandlerStandardizer<T, OptionalMethods, RequiredMethods> {
  return (handler: RouteHandler<T, OptionalMethods, RequiredMethods>) => {
    const methodNames = [
      ...Object.keys(SHARED_OPTIONAL_METHOD_DEFAULTS),
      ...Object.keys(defaults),
      ...requiredNames,
    ];
    return {
      type,
      ...SHARED_OPTIONAL_METHOD_DEFAULTS,
      ...defaults,
      ...Object.assign(
        {},
        ...Object.entries(handler)
          .filter(([ name ]) => methodNames.includes(name))
          .map(([ name, method ]) => ({ [name]: method }))
      ),
    } as StandardizedRouteHandler<T, OptionalMethods, RequiredMethods>;
  }
}

const SHARED_OPTIONAL_METHOD_DEFAULTS: SharedOptionalMethods = {
  getRouteDirective: () => ({ kind: 'ok' }),
  getHeaders: () => new Headers(),
};
