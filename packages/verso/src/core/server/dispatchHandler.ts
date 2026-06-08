import type {AnyStandardizedHandler} from "../common/handler/RouteHandler";
import {handleEndpoint} from "./handleEndpoint";
import {handlePage} from "./handlePage";

export type HandlerResponse = {
  contentType: string;
  body: BodyInit;
};

export function dispatchHandler(handler: AnyStandardizedHandler): HandlerResponse {
  switch(handler.type) {
    case 'page':
      return handlePage(handler);
    case 'endpoint':
      return handleEndpoint(handler);
    default:
      throw new Error(`invalid route handler type ${handler satisfies never}`);
  }
}
