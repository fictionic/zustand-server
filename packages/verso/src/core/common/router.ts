import {match, type ParamData} from "path-to-regexp";
import {ensureArray} from "../../util/array";
import type {RouteConfig, RoutesMap} from "../../build/config";

export interface RouteMatch {
  routeName: string;
  params: ParamData;
  handler: string;
  method: string;
};

export interface Router {
  matchRoute: (path: string, method: string) => RouteMatch | null;
};

export function createRouter(routes: RoutesMap): Router {
  const compiled = Object.entries(routes).map(([routeName, routeConfig]) => {
    return {
      routeName,
      routeConfig,
      matchFn: match(routeConfig.path),
    };
  });
  return {
    matchRoute: (path, method) => {
      for (const { routeName, matchFn, routeConfig } of compiled) {
        if (!routeAcceptsMethod(routeConfig, method)) {
          continue;
        }
        const result = matchFn(path);
        if (result) {
          return {
            routeName,
            params: result.params,
            method,
            handler: routeConfig.handler,
          };
        }
      }
      return null;
    },
  };
}

const DEFAULT_METHOD = 'GET';

export function routeAcceptsMethod(route: RouteConfig, method: string) {
  const acceptedMethods = ensureArray(route.method ?? DEFAULT_METHOD);
  return acceptedMethods.includes(method.toUpperCase());
}
