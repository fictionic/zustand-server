import { describe, expect, test } from 'vitest';
import { withRLS } from '../userland/testing/rls';
import { ServerCookies } from '../core/server/ServerCookies';
import { getServerStash } from '../core/server/stash';

function makeRequest(cookieHeader?: string): Request {
  const headers: HeadersInit = {};
  if (cookieHeader !== undefined) headers['Cookie'] = cookieHeader;
  return new Request('http://localhost/', { headers });
}

describe('ServerCookies', () => {
  test('parses Cookie header correctly', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest('a=1; b=2'));
    expect(sc.getRequestCookie('a')).toBe('1');
    expect(sc.getRequestCookie('b')).toBe('2');
  }));

  test('getRequestCookie returns undefined for missing key', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest('a=1; b=2'));
    expect(sc.getRequestCookie('z')).toBeUndefined();
  }));

  test('setResponseCookie before consumeHeaders stores the cookie', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseCookie('session', 'abc123');
    expect(sc.getResponseCookie('session')).toBe('abc123');
  }));

  test('setResponseCookie after headers are locked throws', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest());
    getServerStash().headersLocked = true;
    expect(() => sc.setResponseCookie('session', 'abc123')).toThrow(
      'cannot set cookies after HTTP headers have been sent'
    );
  }));

  test('consumeHeaders returns Headers with Set-Cookie values', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseCookie('token', 'xyz', { path: '/', httpOnly: true });
    const headers = sc.getResponseSetCookieHeaders();
    const setCookie = headers.get('Set-Cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('token=xyz');
  }));

  test('setResponseSetCookieHeaders parses and stores multiple Set-Cookie strings', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseSetCookieHeaders([
      'user=alice; Path=/',
      'theme=dark; Path=/; HttpOnly',
    ]);
    expect(sc.getResponseCookie('user')).toBe('alice');
    expect(sc.getResponseCookie('theme')).toBe('dark');
  }));

  test('getResponseCookie returns pending response cookie value', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest());
    sc.setResponseCookie('lang', 'en');
    expect(sc.getResponseCookie('lang')).toBe('en');
    expect(sc.getResponseCookie('missing')).toBeUndefined();
  }));

  test('static get() returns instance inside request after construction', () => withRLS(() => {
    const sc = new ServerCookies(makeRequest());
    expect(ServerCookies.get()).toBe(sc);
  }));

  test('static get() returns undefined inside request before any construction', () => withRLS(() => {
    expect(ServerCookies.get()).toBeUndefined();
  }));

  test('static get() throws outside request', () => {
    expect(() => ServerCookies.get()).toThrow('RLS() access outside of request!');
  });
});
