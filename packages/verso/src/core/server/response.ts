import type {AnyStandardizedHandler} from "../common/handler/RouteHandler";
import type {MaybePromise} from "../../util/promise";
import {handleEndpoint} from "./handleEndpoint";
import {handlePage} from "./handlePage";

export type HandlerResponse = {
  getContentType: () => string;
  getBody: () => MaybePromise<BodyInit>;
};

export function getHandlerResponse(handler: AnyStandardizedHandler): HandlerResponse {
  switch(handler.type) {
    case 'page':
      return handlePage(handler);
    case 'endpoint':
      return handleEndpoint(handler);
    default:
      throw new Error(`invalid route handler type ${handler satisfies never}`);
  }
}
