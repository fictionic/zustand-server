import {startRequest} from "../common/RequestLocalStorage";
import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../common/fetch/Fetch";
import {html404, html500} from "./errorPages";
import type {ServerSettings} from "../../build/config";
import {getElapsedRequestTime, startRequestClock} from "./clock";
import type {Resolution, Resolver} from "../common/resolver";
import {cancelAbortTimeout, getAbortPromise, initAbortController, startAbortTimeout} from "../common/abort";
import {getHandlerResponse} from "./response";
import {getServerStash} from "./stash";
import {makeIsomorphicRequest, UntrustedHostError} from "./makeIsomorphicRequest";

export type MakeHandleRequest = (navigator: Resolver, settings: ServerSettings) => HandleRequest;

export type HandleRequest = (request: Request) => Promise<Response>;

export const makeHandleRequest: MakeHandleRequest = (resolver, settings): HandleRequest => {
  async function handleRequest(
    rawReq: Request,
  ) {
    let req: Request;
    try {
      req = makeIsomorphicRequest(rawReq, settings);
    } catch (err) {
      if (err instanceof UntrustedHostError) {
        console.warn("[verso]", err.message);
        return misdirectedRequest();
      }
      throw err;
    }
    const responsePromise = startRequest(async () => {
      startRequestClock();
      initAbortController(req.signal);
      Fetch.serverInit(req, settings, handleRequest);

      getServerStash().request = req;
      getServerStash().rawRequest = rawReq;

      const headers = new Headers();
      function concatHeaders(newHeaders: Headers) {
        newHeaders.forEach((value, name) => {
          headers.append(name, value);
        });
      }

      const cookies = new ServerCookies(req);

      const { routerTimeout } = settings;
      startAbortTimeout(new Error("[verso] resolution timeout"), routerTimeout);
      let resolution: Resolution;
      try {
        resolution = await Promise.race([
          resolver.resolve(req),
          getAbortPromise(),
        ]);
      } finally {
        cancelAbortTimeout();
      }

      switch (resolution.kind) {
        case 'not-found':
          return notFound();
        case 'error':
          throw new Error('[verso] resolution error');
        case 'directive':
          break;
        default:
          resolution satisfies never;
          throw new Error('unexpected resolution result');
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

      const elapsedTime = getElapsedRequestTime();
      const { responseTimeout } = settings;
      const remainingTime = Math.max(0, responseTimeout - elapsedTime);
      startAbortTimeout(new Error("[verso] response timeout"), remainingTime)
      // the responder is responsible for canceling the timeout on response end.
      // (we can't do it, because the body might be a stream)
      const handlerHeaders = handler.getHeaders();
      concatHeaders(handlerHeaders);
      const { getContentType, getBody } = getHandlerResponse(handler);
      headers.append('Content-Type', getContentType());
      const body = await getBody();
      return new Response(body, {
        status,
        headers,
      });
    })
    try {
      return await responsePromise;
    } catch (error) {
      if (req.signal.aborted) {
        // the server will fail to send the response, because the client hung up, but that's ok
        return new Response(null, { status: 499 }); // 499 Client Closed Request (nginx convention)
      }
      console.error("[verso] error in handleRequest", error);
      return internalServerError();
    }
  }
  return handleRequest;
}

function notFound(): Response {
  return new Response(html404, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function internalServerError(): Response {
  return new Response(html500, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function misdirectedRequest(): Response {
  return new Response(null, { status: 421 });
}
