import type {MaybePromise} from "../../../util/promise";
import {defineRouteHandler, type RouteHandler, type RouteHandlerDefinition, type RouteHandlerInit, type StandardizedRouteHandler} from "./RouteHandler";

declare module './RouteHandler' {
  interface HandlerRegistry {
    endpoint: { optional: {}; required: EndpointRequiredMethods };
  }
}

export interface EndpointRequiredMethods {
  getContentType(): string;
  getResponseData(): MaybePromise<BodyInit>;
};

export type Endpoint = RouteHandler<'endpoint', {}, EndpointRequiredMethods>;

export type EndpointInit = RouteHandlerInit<'endpoint', Endpoint>;

export type EndpointDefinition = RouteHandlerDefinition<'endpoint', {}, EndpointRequiredMethods>;

export type StandardizedEndpoint = StandardizedRouteHandler<'endpoint', {}, EndpointRequiredMethods>;

const ENDPOINT_REQUIRED_METHOD_NAMES: (keyof EndpointRequiredMethods)[] = ['getContentType', 'getResponseData'];

export function defineEndpoint(init: EndpointInit): EndpointDefinition {
  return defineRouteHandler('endpoint', init, {}, ENDPOINT_REQUIRED_METHOD_NAMES);
}
