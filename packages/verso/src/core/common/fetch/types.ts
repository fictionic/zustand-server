/**
 * Application-facing types for the Verso fetch system.
 * These are the types an app developer uses when writing interceptors
 * or configuring fetch behavior.
 */

export type VersoFetchInit = RequestInit & {
  body?: string; // disallow binary and ReadableStream bodies
  // TODO: what about FormData? worth supporting?
};

export type FetchRequestSettings = {
  /**
   * By default, only GET requests are run through the cache. With this set,
   * all HTTP methods get their responses cached. Useful for things like GraphQL.
   * Note that multiple calls to the same URL, with this setting enabled, will be
   * de-duped.
   */
  forceToCache?: boolean;
  /**
   * By default, only plaintext responses are stored in the cache. With this set,
   * binary responses are cached. Note that this relies on base64 encoding, so it
   * can bloat the page response. Probably you shouldn't be using binary resources
   * for render, but it's there if you need it.
   */
  forceBinaryToCache?: boolean;
  /**
   * Overrides the same-origin policy for forwarding cookies from the page request.
   * Useful for requests whose domain is transformed to a first-party external host server-side.
   */
  forceForwardRequestCookies?: boolean;
  /**
   * Copies the Set-Cookie headers from the fetch response and attaches them to the
   * Verso page response.
   */
  forwardResponseSetCookieHeaders?: boolean;
};

/**
 * This will not affect the cache key, so it does not have to be isomorphic.
 */
export type InterceptResult = {
  /**
   * The url to use.
   * Helpful if you want to hit a private resource only available server-side without going through
   * the public internet.
   */
  url: string;
  /**
   * Adjust headers, etc.
   * Helpful for automatic CSRF token management.
   */
  init?: VersoFetchInit;
  /**
   * Settings, overridden by any settings passed to the fetch() call.
   * Helpful for things like declaring your GraphQL endpoint so it gets cached.
   */
  settings?: FetchRequestSettings;
}

export type FetchRequestInterceptor = (url: string, init: VersoFetchInit) => InterceptResult;
