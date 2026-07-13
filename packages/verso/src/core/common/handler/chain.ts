import type {MiddlewareDefinition, Middleware, Scope} from "./Middleware";
import type {RouteHandlerDefinition, RouteHandlerType, StandardizedRouteHandler} from "./RouteHandler";
import {MiddlewareConfig} from "./MiddlewareConfig";
import {createCtx, type RouteHandlerCtx} from "./RouteHandlerCtx";
import type {VersoRequest} from "../VersoRequest";
import type {RouteMatch} from "../router";

export function createHandlerChain<T extends RouteHandlerType, OptionalMethods extends {}, RequiredMethods extends {}>(
  def: RouteHandlerDefinition<T, OptionalMethods, RequiredMethods>,
  versoRequest: VersoRequest,
  route: RouteMatch,
  globalMiddleware: MiddlewareDefinition<Scope>[],
): StandardizedRouteHandler<T, OptionalMethods, RequiredMethods> {
  const config = new MiddlewareConfig();
  const ctx = createCtx(config, versoRequest, route);
  const handler = def.init(ctx);

  const baseMiddleware = [...globalMiddleware, ...(handler.middleware ?? [])];
  const allMiddleware = recursivelyExpandMiddleware(baseMiddleware, ctx, def.type);
  allMiddleware.forEach((m) => {
    const addValues = m.addConfigValues?.();
    if (addValues) {
      config.addValues(addValues);
    }
  });
  [...allMiddleware, handler].forEach((r) => {
    const setValues = r.setConfigValues?.();
    if (setValues) {
      config.setValues(setValues);
    }
  });

  const base = def.standardize(handler);
  return allMiddleware.reduceRight((chain, link) => {
    const result = { ...chain };
    for (const methodName of Object.keys(base)) {
      // no way to do this without `as any` because of the correlated union problem
      const current = (link as any)[methodName];
      if (current) {
        const nextRaw = (chain as any)[methodName];
        (result as any)[methodName] = () => {
          let calledNext = false;
          const nextGuarded = () => {
            if (calledNext) {
              throw new Error(`next() called more than once in middleware for '${methodName}'`);
            }
            calledNext = true;
            return nextRaw();
          };
          return current(nextGuarded);
        };
      }
    }
    return result;
  }, base);

}

function recursivelyExpandMiddleware<R extends RouteHandlerType>(
  middlewareDefs: MiddlewareDefinition<Scope>[],
  ctx: RouteHandlerCtx,
  handlerType: R,
): Middleware<R, any>[] {
  if (middlewareDefs.length === 0) {
    return [];
  }
  return middlewareDefs
    .filter((def): def is MiddlewareDefinition<R> => def.scope === 'all' || def.scope === handlerType)
    .flatMap(def => {
      const m = def.init(ctx);
      const children = recursivelyExpandMiddleware(m.middleware ?? [], ctx, handlerType);
      return [...children, m];
    });
}


