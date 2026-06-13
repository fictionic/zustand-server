import { beforeEach, describe, expect, test } from 'vitest';
import { getCookie, setCookie } from '../core/common/cookies';
import { ServerCookies } from '../core/server/ServerCookies';
import { serverSide, clientSide } from '../userland/testing/isomorphic';
import { withRLS } from '../userland/testing/rls';

function makeRequest(cookieHeader?: string): Request {
  const headers: HeadersInit = {};
  if (cookieHeader !== undefined) headers['Cookie'] = cookieHeader;
  return new Request('http://localhost/', { headers });
}

describe('cookies', () => {
  serverSide(() => {
    describe('getCookie', () => {
      test('returns response cookie when set', () => withRLS(() => {
        const sc = new ServerCookies(makeRequest());
        sc.setResponseCookie('session', 'resp-value');
        expect(getCookie('session')).toBe('resp-value');
      }));

      test('returns request cookie when no response cookie is set', () => withRLS(() => {
        new ServerCookies(makeRequest('session=req-value'));
        expect(getCookie('session')).toBe('req-value');
      }));

      test('response cookie takes precedence over request cookie', () => withRLS(() => {
        const sc = new ServerCookies(makeRequest('session=req-value'));
        sc.setResponseCookie('session', 'resp-value');
        expect(getCookie('session')).toBe('resp-value');
      }));

      test('returns undefined when cookie not found', () => withRLS(() => {
        new ServerCookies(makeRequest());
        expect(getCookie('missing')).toBeUndefined();
      }));
    });

    describe('setCookie', () => {
      test('delegates to ServerCookies.setResponseCookie', () => withRLS(() => {
        const sc = new ServerCookies(makeRequest());
        setCookie('theme', 'dark');
        expect(sc.getResponseCookie('theme')).toBe('dark');
      }));

      test('delegates with options', () => withRLS(() => {
        const sc = new ServerCookies(makeRequest());
        setCookie('auth', 'token123', { path: '/', httpOnly: true });
        expect(sc.getResponseCookie('auth')).toBe('token123');
      }));
    });
  });

  clientSide(() => {
    function clearAllCookies() {
      document.cookie.split(';').forEach((c) => {
        const name = c.trim().split('=')[0];
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      });
    }

    describe('getCookie', () => {
      beforeEach(clearAllCookies);

      test('parses document.cookie', () => {
        document.cookie = 'foo=bar';
        expect(getCookie('foo')).toBe('bar');
      });

      test('returns undefined for missing cookie', () => {
        expect(getCookie('nonexistent')).toBeUndefined();
      });
    });

    describe('setCookie', () => {
      beforeEach(clearAllCookies);

      test('sets document.cookie', () => {
        setCookie('theme', 'dark');
        expect(document.cookie).toContain('theme=dark');
      });
    });
  });
});
