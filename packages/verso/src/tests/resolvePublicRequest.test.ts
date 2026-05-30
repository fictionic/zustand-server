import { describe, expect, test } from 'vitest';
import { resolvePublicRequest } from '../core/server/resolvePublicRequest';
import type { RequestContext } from '../vendor/hattip/compose';
import { fillServerSettings, type ServerSettings } from '../build/config';
import { devOnly } from '../userland/testing/dev';
import { serverSide } from '../userland/testing/isomorphic';

function settings(overrides: Partial<ServerSettings> = {}): ServerSettings {
  return fillServerSettings(overrides);
}

function makeCtx(request: Request): RequestContext {
  return {
    request,
    url: new URL(request.url),
    method: request.method,
    ip: '',
    platform: {},
    locals: {},
    env: () => undefined,
    passThrough: () => {},
    waitUntil: () => {},
    next: () => Promise.resolve(new Response()),
    handleError: () => new Response('error', { status: 500 }),
  };
}

async function run(setts: ServerSettings, request: Request): Promise<{ request: Request; response: Response | undefined }> {
  const ctx = makeCtx(request);
  const result = await resolvePublicRequest(setts)(ctx);
  const response = result instanceof Response ? result : undefined;
  return { request: ctx.request, response };
}

serverSide(() => {
  describe('resolvePublicRequest', () => {
    describe('without trustProxy', () => {
      test('passes through valid host', async () => {
        const raw = new Request('http://myapp.com/foo?x=1');
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(request.url).toBe('http://myapp.com/foo?x=1');
      });

      test('preserves non-default port', async () => {
        const raw = new Request('http://myapp.com:8080/foo');
        const { request } = await run(settings({ allowedHosts: ['myapp.com:8080'] }), raw);
        expect(request.url).toBe('http://myapp.com:8080/foo');
      });

      test('preserves https protocol', async () => {
        const raw = new Request('https://myapp.com/foo');
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(request.url).toBe('https://myapp.com/foo');
      });

      test('preserves method', async () => {
        const raw = new Request('http://myapp.com/foo', { method: 'POST' });
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(request.method).toBe('POST');
      });

      test('preserves Cookie header', async () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'Cookie': 'session=abc' },
        });
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(request.headers.get('cookie')).toBe('session=abc');
      });

      test('preserves path and search', async () => {
        const raw = new Request('http://myapp.com/some/deep/path?a=1&b=2');
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        const url = new URL(request.url);
        expect(url.pathname).toBe('/some/deep/path');
        expect(url.search).toBe('?a=1&b=2');
      });

      test('preserves AbortSignal', async () => {
        const controller = new AbortController();
        const raw = new Request('http://myapp.com/foo', { signal: controller.signal });
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        controller.abort('test');
        expect(request.signal.aborted).toBe(true);
      });

      test('rejects with 421 when host is not in allowedHosts', async () => {
        const raw = new Request('http://evil.com/foo');
        const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(response?.status).toBe(421);
      });

      test('treats host match case-insensitively', async () => {
        // URL constructor lowercases hostname, so this also exercises the path where
        // host already arrives lowercase. The case-insensitive comparison is what
        // makes a header-derived host like "MyApp.com" still match here.
        const raw = new Request('http://MyApp.com/foo');
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(new URL(request.url).host).toBe('myapp.com');
      });

      test('rejects on host mismatch when only port differs', async () => {
        const raw = new Request('http://myapp.com:8080/foo');
        const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(response?.status).toBe(421);
      });

      test('ignores X-Forwarded-Host when trustProxy is false', async () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Host': 'evil.com' },
        });
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(request.url).toBe('http://myapp.com/foo');
      });

      test('ignores X-Forwarded-Proto when trustProxy is false', async () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Proto': 'https' },
        });
        const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(request.url).toBe('http://myapp.com/foo');
      });
    });

    describe('with trustProxy', () => {
      test('uses X-Forwarded-Host when present', async () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'myapp.com' },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('http://myapp.com/foo');
      });

      test('uses X-Forwarded-Proto when present', async () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Proto': 'https' },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('https://myapp.com/foo');
      });

      test('combines X-Forwarded-Host and X-Forwarded-Proto', async () => {
        const raw = new Request('http://localhost:3000/foo?x=1', {
          headers: {
            'X-Forwarded-Host': 'myapp.com',
            'X-Forwarded-Proto': 'https',
          },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('https://myapp.com/foo?x=1');
      });

      test('uses the first value from a comma-separated X-Forwarded-Host chain', async () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'myapp.com, proxy1.local, proxy2.local' },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('http://myapp.com/foo');
      });

      test('uses the first value from a comma-separated X-Forwarded-Proto chain', async () => {
        const raw = new Request('http://myapp.com/foo', {
          headers: { 'X-Forwarded-Proto': 'https, http' },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('https://myapp.com/foo');
      });

      test('trims whitespace from comma-separated entries', async () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': '   myapp.com   , proxy1.local' },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('http://myapp.com/foo');
      });

      test('falls back to incoming Host when X-Forwarded-Host is absent', async () => {
        const raw = new Request('http://myapp.com/foo');
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('http://myapp.com/foo');
      });

      test('falls back to incoming protocol when X-Forwarded-Proto is absent', async () => {
        const raw = new Request('https://myapp.com/foo');
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(request.url).toBe('https://myapp.com/foo');
      });

      test('rejects with 421 when X-Forwarded-Host is not in allowedHosts', async () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'evil.com' },
        });
        const { response } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(response?.status).toBe(421);
      });

      test('matches mixed-case X-Forwarded-Host case-insensitively', async () => {
        const raw = new Request('http://localhost:3000/foo', {
          headers: { 'X-Forwarded-Host': 'MyApp.com' },
        });
        const { request } = await run(settings({
          trustProxy: true,
          allowedHosts: ['myapp.com'],
        }), raw);
        expect(new URL(request.url).host).toBe('myapp.com');
      });
    });

    describe('localhost dev bypass', () => {
      devOnly(() => {
        test('bypasses allowedHosts for localhost when IS_DEV is true', async () => {
          const raw = new Request('http://localhost/foo');
          const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
          expect(request.url).toBe('http://localhost/foo');
        });

        test('bypasses allowedHosts for 127.0.0.1 when IS_DEV is true', async () => {
          const raw = new Request('http://127.0.0.1/foo');
          const { request } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
          expect(request.url).toBe('http://127.0.0.1/foo');
        });

        test('still rejects non-local hosts when IS_DEV is true', async () => {
          const raw = new Request('http://evil.com/foo');
          const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
          expect(response?.status).toBe(421);
        });
      });

      test('does not bypass for localhost when IS_DEV is false', async () => {
        const raw = new Request('http://localhost/foo');
        const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(response?.status).toBe(421);
      });

      test('does not bypass for 127.0.0.1 when IS_DEV is false', async () => {
        const raw = new Request('http://127.0.0.1/foo');
        const { response } = await run(settings({ allowedHosts: ['myapp.com'] }), raw);
        expect(response?.status).toBe(421);
      });

      test('localhost in allowedHosts is accepted regardless of IS_DEV', async () => {
        const raw = new Request('http://localhost/foo');
        const { request } = await run(settings({ allowedHosts: ['localhost'] }), raw);
        expect(request.url).toBe('http://localhost/foo');
      });
    });
  });
});
