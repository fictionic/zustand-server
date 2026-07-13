import type {ClientManifest, Serve} from "@verso-js/contract";
import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../common/fetch/Fetch";
import type {ServerSettings} from "../../build/config";
import type {Resolver} from "../common/resolver";
import {dispatchHandler} from "./dispatchHandler";
import {getServerStash} from "./stash";
import {initAbort} from "../common/abort";
import type {RequestHandler} from "../../vendor/hattip/compose";

type Opts = {
  resolver: Resolver,
  manifest: ClientManifest | null, // null in dev
  loopback: Serve,
  settings: ServerSettings
};

export function serveResponse({
  resolver,
  manifest,
  loopback,
  settings,
}: Opts): RequestHandler {
  return async (ctx) => {
    const req = ctx.request;

    initAbort(req.signal);

    getServerStash().request = req;
    getServerStash().manifest = manifest;
    getServerStash().headersLocked = false;

    Fetch.serverInit(req, loopback, settings);

    const headers = new Headers();
    function concatHeaders(newHeaders: Headers) {
      newHeaders.forEach((value, name) => {
        headers.append(name, value);
      });
    }

    const cookies = new ServerCookies(req);

    const resolution = await resolver.resolve(req);

    switch (resolution.kind) {
      case 'not-found':
        return; // passthrough to fallback hattip 404 handler
      case 'error':
        throw new Error('[verso] resolution error');
      case 'response':
        break;
      default:
        throw new Error('unexpected resolution result', resolution satisfies never);
    }

    const { statusCode, redirectLocation: locationHeader, handler, routeName } = resolution;

    getServerStash().routeName = routeName;

    const cookieHeaders = cookies.getResponseSetCookieHeaders();
    concatHeaders(cookieHeaders);

    if (locationHeader) {
      headers.append('Location', locationHeader);
    }

    // response headers are locked in. any userland attempts to update them (either
    // with cookies.ts or indirectly with a properly configured fetch) will fail loudly.
    getServerStash().headersLocked = true;

    if (!handler) {
      // non-2XX response
      return new Response(null, {
        status: statusCode,
        headers,
      });
    }

    const handlerHeaders = handler.getHeaders();
    concatHeaders(handlerHeaders);
    const { contentType, body } = dispatchHandler(handler);
    headers.append('Content-Type', contentType);
    return new Response(body, {
      status: statusCode,
      headers,
    });
  }
}
