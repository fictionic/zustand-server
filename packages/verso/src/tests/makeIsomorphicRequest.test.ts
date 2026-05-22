import { describe, expect, test } from 'vitest';
import { makeIsomorphicRequest, UntrustedHostError } from '../core/server/makeIsomorphicRequest';
import { fillServerSettings, type ServerSettings } from '../build/config';
import { serverSide } from '../userland/testing/isomorphic';

function settings(overrides: Partial<ServerSettings> = {}): ServerSettings {
  return fillServerSettings(overrides);
}

serverSide(() => {
  describe('makeIsomorphicRequest', () => {
    describe('without trustProxy', () => {
      test('passes through valid host', () => {
        const raw = new Request('http://myapp.com/foo?x=1');
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(result.url).toBe('http://myapp.com/foo?x=1');
      });

      test('preserves non-default port', () => {
        const raw = new Request('http://myapp.com:8080/foo');
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com:8080'] }));
        expect(result.url).toBe('http://myapp.com:8080/foo');
      });

      test('preserves https protocol', () => {
        const raw = new Request('https://myapp.com/foo');
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(result.url).toBe('https://myapp.com/foo');
      });

      test('preserves method', () => {
        const raw = new Request('http://myapp.com/foo', { method: 'POST' });
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(result.method).toBe('POST');
      });

      test('preserves Cookie header', () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'Cookie': 'session=abc' },
        });
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(result.headers.get('cookie')).toBe('session=abc');
      });

      test('preserves path and search', () => {
        const raw = new Request('http://myapp.com/some/deep/path?a=1&b=2');
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        const url = new URL(result.url);
        expect(url.pathname).toBe('/some/deep/path');
        expect(url.search).toBe('?a=1&b=2');
      });

      test('preserves AbortSignal', () => {
        const controller = new AbortController();
        const raw = new Request('http://myapp.com/foo', { signal: controller.signal });
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        controller.abort('test');
        expect(result.signal.aborted).toBe(true);
      });

      test('throws UntrustedHostError when host is not in allowedHosts', () => {
        const raw = new Request('http://evil.com/foo');
        expect(() => makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] })))
          .toThrow(UntrustedHostError);
      });

      test('UntrustedHostError message contains the offending host', () => {
        const raw = new Request('http://evil.com/foo');
        expect(() => makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] })))
          .toThrow(/evil\.com/);
      });

      test('treats host match case-insensitively', () => {
        // URL constructor lowercases hostname, so this also exercises the path where
        // host already arrives lowercase. The case-insensitive comparison is what
        // makes a header-derived host like "MyApp.com" still match here.
        const raw = new Request('http://MyApp.com/foo');
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(new URL(result.url).host).toBe('myapp.com');
      });

      test('rejects on host mismatch when only port differs', () => {
        const raw = new Request('http://myapp.com:8080/foo');
        expect(() => makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] })))
          .toThrow(UntrustedHostError);
      });

      test('ignores X-Forwarded-Host when trustProxy is false', () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Host': 'evil.com' },
        });
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(result.url).toBe('http://myapp.com/foo');
      });

      test('ignores X-Forwarded-Proto when trustProxy is false', () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Proto': 'https' },
        });
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] }));
        expect(result.url).toBe('http://myapp.com/foo');
      });
    });

    describe('with trustProxy', () => {
      test('uses X-Forwarded-Host when present', () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'myapp.com' },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('http://myapp.com/foo');
      });

      test('uses X-Forwarded-Proto when present', () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Proto': 'https' },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('https://myapp.com/foo');
      });

      test('combines X-Forwarded-Host and X-Forwarded-Proto', () => {
        const raw = new Request('http://localhost:3000/foo?x=1', {
          headers: {
            'X-Forwarded-Host': 'myapp.com',
            'X-Forwarded-Proto': 'https',
          },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('https://myapp.com/foo?x=1');
      });

      test('uses the first value from a comma-separated X-Forwarded-Host chain', () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'myapp.com, proxy1.local, proxy2.local' },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('http://myapp.com/foo');
      });

      test('uses the first value from a comma-separated X-Forwarded-Proto chain', () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Proto': 'https, http' },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('https://myapp.com/foo');
      });

      test('trims whitespace from comma-separated entries', () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': '   myapp.com   , proxy1.local' },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('http://myapp.com/foo');
      });

      test('falls back to incoming Host when X-Forwarded-Host is absent', () => {
        const raw = new Request('http://myapp.com/foo');
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('http://myapp.com/foo');
      });

      test('falls back to incoming protocol when X-Forwarded-Proto is absent', () => {
        const raw = new Request('https://myapp.com/foo');
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(result.url).toBe('https://myapp.com/foo');
      });

      test('throws when X-Forwarded-Host is not in allowedHosts', () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'evil.com' },
        });
        expect(() => makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }))).toThrow(UntrustedHostError);
      });

      test('matches mixed-case X-Forwarded-Host case-insensitively', () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'MyApp.com' },
        });
        const result = makeIsomorphicRequest(raw, settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }));
        expect(new URL(result.url).host).toBe('myapp.com');
      });
    });

    describe('localhost dev bypass', () => {
      // These exercise the `globalThis.IS_DEV && LOCAL_HOSTS.includes(...)` branch.
      // The vitest config bakes `globalThis.IS_DEV` to `false` at compile time, so
      // the branch is unreachable from this config. Would need a parallel test config
      // with `IS_DEV: true` to cover.
      test.todo('bypasses allowedHosts for localhost when IS_DEV is true');
      test.todo('bypasses allowedHosts for 127.0.0.1 when IS_DEV is true');
      test.todo('still rejects non-local hosts when IS_DEV is true');

      test('does not bypass for localhost when IS_DEV is false', () => {
        const raw = new Request('http://localhost/foo');
        expect(() => makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] })))
          .toThrow(UntrustedHostError);
      });

      test('does not bypass for 127.0.0.1 when IS_DEV is false', () => {
        const raw = new Request('http://127.0.0.1/foo');
        expect(() => makeIsomorphicRequest(raw, settings({ allowedHosts: ['myapp.com'] })))
          .toThrow(UntrustedHostError);
      });

      test('localhost in allowedHosts is accepted regardless of IS_DEV', () => {
        const raw = new Request('http://localhost/foo');
        const result = makeIsomorphicRequest(raw, settings({ allowedHosts: ['localhost'] }));
        expect(result.url).toBe('http://localhost/foo');
      });
    });
  });
});
