import type {IncomingMessage, ServerResponse} from "node:http";
import type {Serve} from "@verso-js/contract";
import {toWebRequest} from "./vendor/hattip/node-request";
import {sendWebResponse} from "./vendor/hattip/node-response";

export type NodeRequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Converts a Web `Request => Promise<Response>` handler into a Node
 * `(IncomingMessage, ServerResponse) => Promise<void>` handler.
 * Mostly just a wrapper around a vendored Hattip implementation.
 */
export function toNodeRequestHandler(serve: Serve): NodeRequestHandler {
  return async (nodeReq, nodeRes) => {
    try {
      // this correctly hooks up an abortsignal based on the http req/res
      const webReq = toWebRequest(nodeReq, nodeRes);
      const webRes = await serve(webReq);
      await sendWebResponse(nodeReq, nodeRes, webRes);
    } catch (err) {
      if (nodeRes.destroyed || nodeRes.writableEnded) {
        return;
      }
      console.error('Unexpected error', err);
      nodeRes.statusCode = 500;
      nodeRes.end();
    }
  };
}
