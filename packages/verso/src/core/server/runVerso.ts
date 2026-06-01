import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../common/fetch/Fetch";
import type {ServerSettings} from "../../build/config";
import type {Resolver} from "../common/resolver";
import {getHandlerResponse} from "./response";
import {getServerStash} from "./stash";
import {initAbort} from "../common/abort";
import type {RequestHandler} from "../../vendor/hattip/compose";
import type {ClientManifest} from "../../build/manifest";
import type {Serve} from "./createVersoServer";

export type RunVerso = (opts: {
  resolver: Resolver,
  manifest: ClientManifest | null, // null in dev
  loopback: Serve,
  settings: ServerSettings
}) => RequestHandler;

export const runVerso: RunVerso = ({
  resolver,
  manifest,
  loopback,
  settings,
}) => {
  return async (ctx) => {
    const req = ctx.request;

    initAbort(req.signal);

    getServerStash().request = req;
    getServerStash().manifest = manifest;
    // ^it'd be awkward to wire this through to handlePage

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
        return; // passthrough
      case 'error':
        throw new Error('[verso] resolution error');
      case 'directive':
        break;
      default:
        throw new Error('unexpected resolution result', resolution satisfies never);
    }

    const { status, location: locationDirective, handler, routeName } = resolution;

    getServerStash().routeName = routeName;

    const cookieHeaders = cookies.consumeHeaders();
    concatHeaders(cookieHeaders);

    if (locationDirective) {
      headers.append('Location', locationDirective);
    }

    if (!handler) {
      return new Response(null, {
        status,
        headers,
      });
    }

    const handlerHeaders = handler.getHeaders();
    concatHeaders(handlerHeaders);
    const { getContentType, getBody } = getHandlerResponse(handler);
    headers.append('Content-Type', getContentType());
    const body = await getBody();
    return new Response(body, {
      status,
      headers,
    });
  }
}
