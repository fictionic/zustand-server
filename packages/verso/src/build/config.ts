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
   * Directory from which to serve static content, or null to disable.
   *
   * Default: null.
   */
  staticDir: string | null;
  /**
   * Hosts permitted to reach the server. Requests whose Host header (or
   * X-Forwarded-Host, when `trustProxy` is enabled) does not match an entry
   * here are rejected with a 421 Misdirected Request.
   *
   * Matching is case-insensitive and includes the port if present in the
   * header. Entries beginning with `*` match any host ending with the
   * remainder of the string (e.g. `*.example.com` matches `app.example.com`
   * and `foo.bar.example.com`).
   *
   * In dev mode, `localhost` and `127.0.0.1` (with any port) are always
   * allowed regardless of this list.
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
   * Failsafe timeout, in ms, for the server to start streaming the response (TTFB).
   * Timeouts result in an HTTP 500.
   *
   * Default: 20_000 (20 seconds).
   */
  responseStartTimeout: number;
  /**
   * Failsafe timeout, in ms, for the server to finish streaming the response.
   *
   * If the timeout is hit during render, hydration will be aborted--unrendered
   * Roots will be skipped, and the page will end up in a degraded state.
   *
   * Endpoints that stream a response should handle getRequest().signal themselves,
   * otherwise they will do wasted work--the response will close and they will
   * stream into the ether.
   *
   * Default: 20_000 (20 seconds).
   */
  responseEndTimeout: number;
};

const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  staticDir: null,
  allowedHosts: ['localhost'],
  trustProxy: false,
  fetchOrigin: 'request-host',
  responseStartTimeout: 20_000,
  responseEndTimeout: 20_000,
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
