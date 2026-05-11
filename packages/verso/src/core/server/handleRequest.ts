import {startRequest} from "../common/RequestLocalStorage";
import {ServerCookies} from "./ServerCookies";
import {Fetch} from "../common/fetch/Fetch";
import {html404, html500} from "./errorPages";
import type {ServerSettings} from "../../build/config";
import {getElapsedRequestTime, startRequestClock} from "./clock";
import type {NavigationResult, Navigator} from "../common/navigator";
import {cancelAbortTimeout, getAbortPromise, initAbortController, startAbortTimeout} from "./abort";
import {getHandlerResponse} from "./response";

export type MakeHandleRequest = (navigator: Navigator, settings: ServerSettings) => HandleRequest;

export type HandleRequest = (request: Request) => Promise<Response>;

export const makeHandleRequest: MakeHandleRequest = (navigator, settings): HandleRequest => {
  async function handleRequest(
    req: Request,
  ) {
    const responsePromise = startRequest(async () => {
      startRequestClock();
      initAbortController(req.signal);
      Fetch.serverInit(req, settings, handleRequest);

      const headers = new Headers();
      function concatHeaders(newHeaders: Headers) {
        newHeaders.forEach((value, name) => {
          headers.append(name, value);
        });
      }

      const cookies = new ServerCookies(req);

      const { routerTimeout } = settings;
      startAbortTimeout(new Error("[verso] navigation timeout"), routerTimeout);
      let navigation: NavigationResult;
      try {
        navigation = await Promise.race([
          navigator.navigate(req),
          getAbortPromise(),
        ]);
      } finally {
        cancelAbortTimeout();
      }

      switch (navigation.kind) {
        case 'not-found':
          return notFound();
        case 'error':
          throw new Error('[verso] navigation error');
        case 'directive':
          break;
        default:
          navigation satisfies never;
          throw new Error('unexpected navigation result');
      }

      const { status, location: locationDirective, handler } = navigation;

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
