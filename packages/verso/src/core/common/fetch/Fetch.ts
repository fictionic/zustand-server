import type {FetchOrigin, ServerSettings} from '../../../build/config';
import {getAbortSignal} from '../abort';
import {ServerCookies} from '../../server/ServerCookies';
import { getRLS } from '../RequestLocalStorage';
import { FetchCache, reifyCachedResponse, type CacheableRequest, type DehydratedCache } from './cache';
import { nativeFetch } from './nativeFetch';
import type { FetchRequestInterceptor, FetchRequestSettings, VersoFetchInit } from './types';
import type {HandleRequest} from '../../server/handleRequest';
import {hasBinaryBody} from '../util/body';

const DEFAULT_SETTINGS: Required<FetchRequestSettings> = {
  forceToCache: false,
  forceBinaryToCache: false,
  forceForwardRequestCookies: false,
  forwardResponseSetCookieHeaders: false,
};

function fillSettings(primary: FetchRequestSettings | undefined, overrides: FetchRequestSettings | undefined): Required<FetchRequestSettings> {
  return Object.assign({}, DEFAULT_SETTINGS, primary, overrides);
}

const RLS = getRLS<{
  cache: FetchCache;
  requestOrigin?: string;
  originSetting?: FetchOrigin;
  handleLoopbackRequest?: HandleRequest;
  interceptor?: FetchRequestInterceptor;
}>();

// the verso-facing interface
export const Fetch = {
  serverInit,
  clientInit,
  getCache,
  fetch,
};

export function setFetchInterceptor(interceptor: FetchRequestInterceptor) {
  RLS().interceptor = interceptor;
}

function serverInit(
  nativeRequest: Request,
  serverSettings: ServerSettings,
  loopback: HandleRequest,
) {
  RLS().cache = new FetchCache();
  RLS().requestOrigin = new URL(nativeRequest.url).origin;
  RLS().originSetting = serverSettings.fetchOrigin;
  RLS().handleLoopbackRequest = loopback;
}

function clientInit(fetchCache?: DehydratedCache) {
  const cache = new FetchCache();
  if (fetchCache) {
    cache.client().rehydrate(fetchCache);
  }
  RLS().cache = cache;
}

function getCache() {
  return RLS().cache;
}

/**
 * Isomorphic wrapper around native fetch.
 * Intentionally only supporting url inputs because it's not worth the complexity
 * when the main use-case is for relative urls, which cannot be passed to URL or Request objects.
 */
async function fetch(rawUrl: string, rawInit: VersoFetchInit = {}, overrideSettings?: FetchRequestSettings): Promise<Response> {
  const {
    url: interceptedUrl,
    init: _interceptedInit,
    settings: interceptedSettings,
  } = interceptRequest(rawUrl, rawInit);

  const interceptedInit: VersoFetchInit = _interceptedInit ?? {};

  const {
    forceToCache,
    forceBinaryToCache,
    forceForwardRequestCookies,
    forwardResponseSetCookieHeaders,
  } = fillSettings(interceptedSettings, overrideSettings);

  // TODO: strip out stuff from the request that isn't isomorphic or that we don't need? (see RSA)

  const { resolvedUrl, useLoopback } = resolveRelativeUrl(interceptedUrl);

  const resolvedInit = {
    ...interceptedInit,
    ...resolveForwardedCookies(interceptedUrl, interceptedInit, forceForwardRequestCookies),
    ...resolveAbortSignal(interceptedInit),
  };

  const resolvedRequest = new Request(resolvedUrl, resolvedInit);

  const sendRequest = () => {
    if (useLoopback) {
      return RLS().handleLoopbackRequest!(resolvedRequest);
    } else {
      return nativeFetch(resolvedRequest);
    }
  };

  const useCache = resolvedRequest.method === 'GET' || forceToCache;

  if (!useCache) {
    return sendRequest();
  }

  const req: CacheableRequest = {
    url: rawUrl, // key on raw url
    method: resolvedRequest.method,
    body: interceptedInit?.body ?? null,
  };

  if (globalThis.IS_SERVER) {
    const cache = getCache().server();
    const { first, responsePromise } = cache.receiveRequest(req);
    if (first) {
      try {
        // make the request
        const res = await sendRequest();
        if (forwardResponseSetCookieHeaders) {
          // grab set-cookie headers and attach them to the page response
          const headers = res.headers.getSetCookie();
          ServerCookies.get()!.setResponseSetCookieHeaders(headers);
        }
        if (hasBinaryBody(res) && !forceBinaryToCache) {
          // evict from cache, reuse the response for any parallel requesters
          cache.evictRequest(req, res);
        } else {
          // cache the response for transport
          cache.receiveResponse(req, res);
        }
      } catch (error: any) {
        cache.receiveError(req, error);
      };
    }
    // give the caller back the response from the cache. they don't get the real response.
    // (technically evicted requests do send back the original response)
    return reifyCachedResponse(responsePromise);
  } else {
    // IS_CLIENT
    const cache = getCache().client();
    const responsePromise = cache.receiveRequest(req);
    if (responsePromise) {
      // cache hit. wait for the response (data might be here already, or it might be a late arrival),
      // then consume it and replay it isomorphically
      return reifyCachedResponse(responsePromise)
        .finally(() => cache.consumeResponse(req));
    } else {
      // either we're post-hydration, or the client made a non-isomorphic request.
      // either way, all we can do is pass through
      return sendRequest();
    }
  }
}

const interceptRequest: FetchRequestInterceptor = (url, init) => {
  const interceptor = RLS().interceptor ?? defaultInterceptor;
  return interceptor(url, init);
}

const defaultInterceptor: FetchRequestInterceptor = (url, init) => {
  return { url, init };
}

// we're calling native fetch() with a Request object, so we have to resolve relative urls
// into absolute urls on server and on client.
function resolveRelativeUrl(interceptedUrl: string): { resolvedUrl: string, useLoopback?: boolean } {
  // requestOrigin is the origin specified by the Verso request's Host header
  const origin = globalThis.IS_SERVER ? RLS().requestOrigin : location.origin;
  // throw if url string is not a valid url (absolute or relative).
  // (note that we are not caching these errors, because they occur before we can assemble the Request)
  // (the behavior should still be isomorphic, however)
  const resolvedUrl = new URL(interceptedUrl, origin).href;
  // determine if we should use loopback: server-side, relative url, only if setting is set
  const useLoopback = globalThis.IS_SERVER && isRelativeUrl(interceptedUrl) && RLS().originSetting === 'loopback';
  return {
    resolvedUrl,
    useLoopback,
  };
}

function resolveAbortSignal(interceptedInit: VersoFetchInit = {}): VersoFetchInit {
  const callerSignal = interceptedInit.signal;
  const versoSignal = getAbortSignal();
  return {
    signal: callerSignal ? AbortSignal.any([callerSignal, versoSignal]) : versoSignal,
  };
}

function resolveForwardedCookies(interceptedUrl: string, interceptedInit: VersoFetchInit, forceForwardRequestCookies?: boolean): VersoFetchInit {
  if (!globalThis.IS_SERVER) return {};
  if (!shouldForwardCookies(interceptedUrl, interceptedInit, forceForwardRequestCookies)) return {};
  return {
    headers: getForwardedCookieHeaders(interceptedInit),
  };
}

function shouldForwardCookies(url: string, init: VersoFetchInit, forceForwardRequestCookies?: boolean): boolean {
  if (init?.credentials === 'omit') return false; // leaning towards security in this edge case
  return (
    init?.credentials === 'include' ||
    forceForwardRequestCookies ||
    isSameOrigin(url)
  );
}

function getForwardedCookieHeaders(init: VersoFetchInit): Headers {
  const headers = new Headers(init.headers);
  headers.set('Cookie', ServerCookies.get()!.getRequestCookieHeader());
  return headers;
}

function isSameOrigin(urlString: string): boolean {
  if (isRelativeUrl(urlString)) return true;
  const url = new URL(urlString);
  if (url.origin === RLS().requestOrigin) return true;
  return false;
}

function isRelativeUrl(url: string): boolean {
  return url.startsWith('/');
}
