import type {MiddlewareConfig} from "./MiddlewareConfig";
import type {VersoRequest} from "../VersoRequest";
import type {ParamData} from "path-to-regexp";
import type {RouteMatch} from "../router";

export type RouteInfo = {
  readonly name: string;
  readonly params: ParamData;
}

export interface RouteHandlerCtx {
  getConfigValue: MiddlewareConfig['getValue'];
  getRoute(): RouteInfo;
  getRequest(): VersoRequest;
}

export function createCtx(config: MiddlewareConfig, versoRequest: VersoRequest, route: RouteMatch): RouteHandlerCtx {
  const routeInfo = Object.freeze({
    name: route.routeName,
    params: route.params,
  });
  return Object.freeze({
    getConfigValue: config.getValue,
    getRequest: () => versoRequest,
    getRoute: () => routeInfo,
  });
}
