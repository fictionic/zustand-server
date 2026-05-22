export interface VersoConfig {
  server?: Partial<ServerSettings>;
  client?: Partial<ClientSettings>;
  middleware?: string[];
  routes: RoutesMap;
}

export type FetchOrigin = 'request-host' | 'loopback';

// note that these are currently serialized into the server entrypoint.
// non-serializable values cannot be added
export type ServerSettings = {
  /**
   * TODO
   *
   * Default: ['localhost']
   */
  allowedHosts: string[];
  /**
   * Whether to trust the X-Forwarded-Proto and X-Forwarded-Host headers.
   * If true, these headers will be used to assemble the URL of the request
   * that getRequest() presents to route handlers server-side.
   * Only set this if your server is sitting behind a reverse proxy.
   *
   * Default: false.
   */
  trustProxy: boolean;
  /**
   * How to handle server-side fetch() requests made against relative URLs.
   * - 'request-host':
   *     Use the origin from the Host header of the Verso request.
   *     This guarantees isomorphism between server and client, but
   *     involves going out through the public internet, which can be slow.
   * - 'loopback':
   *     Use the loopback address to talk to the same Verso server.
   *     In fact, with this setting, fetch() won't make an HTTP request at all;
   *     it will simply execute the request against the Verso server within the
   *     same process.
   *     Of course, you should only set this if you know all requests
   *     to relative URLs are actually routed by your Verso server.
   *
   * If neither of these is desireable, configure an interceptor via
   * setFetchInterceptor(), and rewrite relative URLs to absolute URLs as desired.
   *
   * Default: 'request-host'.
   */
  fetchOrigin: FetchOrigin;
  /**
   * Failsafe timeout, in ms, for the server-side resolution of getRouteDirective.
   * Timeouts result in an HTTP 500.
   *
   * Default: 20_000 (20 seconds).
   */
  routerTimeout: number;
  /**
   * Failsafe timeout, in ms, for the full server-side response. If the timeout is hit
   * during render, the request will be aborted--all unrendered Roots will be skipped.
   * (Similarly for endpoints.)
   *
   * Default: 20_000 (20 seconds).
   */
  responseTimeout: number;
};

const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  allowedHosts: ['localhost'],
  trustProxy: false,
  fetchOrigin: 'request-host',
  routerTimeout: 20_000,
  responseTimeout: 20_000,
};

export function fillServerSettings(s?: Partial<ServerSettings>): ServerSettings {
  const settings = Object.assign({}, DEFAULT_SERVER_SETTINGS, s);
  if (settings.allowedHosts.length === 0) {
    throw new Error("[verso] allowedHosts cannot be empty!");
  }
  return settings;
};

export type ClientSettings = {
  /**
   * Whether client navigations should reuse existing DOM elements by default
   * (overridable per-navigation via the options passed to naviateTo).
   *
   * Default: false.
   */
  reuseDom: boolean;
};

const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  reuseDom: false,
};

export function fillClientSettings(s?: Partial<ClientSettings>): ClientSettings {
  return Object.assign({}, DEFAULT_CLIENT_SETTINGS, s);
}

export type RoutesMap = {
  [routeName: string]: {
    path: string;
    handler: string;
    method?: string | string[];
  };
};

export function defineConfig(config: VersoConfig): VersoConfig {
  return config;
}
