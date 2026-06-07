import { parseCookie, parseSetCookie, stringifyCookie, stringifySetCookie, type Cookies, type SetCookie } from 'cookie';
import { getRLS } from '../common/RequestLocalStorage';
import {getServerStash} from './stash';

export type CookieOptions = Omit<SetCookie, 'name' | 'value'>;

const RLS = getRLS<{ current: ServerCookies }>();

export class ServerCookies {
  private requestCookies: Cookies;
  private responseCookies: Map<string, { value: string; options?: CookieOptions }>;

  constructor(req: Request) {
    this.requestCookies = parseCookie(req.headers.get('cookie') ?? '');
    this.responseCookies = new Map();
    RLS().current = this;
  }

  getRequestCookie(name: string): string | undefined {
    return this.requestCookies[name] ?? undefined;
  }

  getRequestCookieHeader(): string {
    return stringifyCookie(this.requestCookies);
  }

  setResponseCookie(name: string, value: string, options?: CookieOptions) {
    throwIfHeadersLocked();
    this.responseCookies.set(name, { value, options });
  }

  setResponseSetCookieHeaders(headers: string[]) {
    throwIfHeadersLocked();
    headers.forEach((header) => {
      const { name, value, ...options } = parseSetCookie(header);
      this.setResponseCookie(name, value ?? '', options);
    });
  }

  getResponseCookie(name: string): string | undefined {
    return this.responseCookies.get(name)?.value;
  }

  getResponseSetCookieHeaders(): Headers {
    const headers = new Headers();
    this.responseCookies.forEach(({ value, options }, name) => {
      headers.append('Set-Cookie', stringifySetCookie({ name, value, ...options }));
    });
    return headers;
  }

  static get(): ServerCookies | undefined {
    return RLS().current;
  }
}

function throwIfHeadersLocked() {
  if (getServerStash().headersLocked) {
    throw new Error("cannot set cookies after HTTP headers have been sent");
  }
}
