import { describe, test, expect, vi } from 'vitest';
import { Resolver } from '../core/common/resolver';
import { definePage } from '../core/common/handler/Page';
import { defineEndpoint } from '../core/common/handler/Endpoint';
import { defineMiddleware } from '../core/common/handler/Middleware';
import type { RoutesMap } from '../build/config';
import type { RouteHandlerDefinition, RouteHandlerType } from '../core/common/handler/RouteHandler';
import {withRLS} from '../userland/testing';

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method });
}

type AnyDef = RouteHandlerDefinition<RouteHandlerType, any, any>;

describe('Resolver', () => {
  describe('Route matching & dispatch', () => {
    test('URL matching a defined route → kind: response, routeName set, handler present', async () => {
      const routes: RoutesMap = {
        home: { path: '/', handler: 'HomeHandler' },
      };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, (name) => name === 'home' ? handler : null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.routeName).toBe('home');
      expect(res.handler).toBeDefined();
    });

    test('URL matching no route → kind: not-found', async () => {
      const routes: RoutesMap = {
        home: { path: '/', handler: 'HomeHandler' },
      };
      const resolver = new Resolver(routes, () => null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/missing')));
      expect(res.kind).toBe('not-found');
    });

    test('method mismatch (POST to GET-only route) → kind: not-found', async () => {
      const routes: RoutesMap = {
        home: { path: '/', handler: 'HomeHandler', method: 'GET' },
      };
      const resolver = new Resolver(routes, () => null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/', 'POST')));
      expect(res.kind).toBe('not-found');
    });

    test('first-match-wins: overlapping paths resolve to the first definition', async () => {
      const routes: RoutesMap = {
        specific: { path: '/users/admin', handler: 'AdminHandler' },
        general: { path: '/users/:id', handler: 'UserHandler' },
      };
      const specificHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const generalHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const handlers: Record<string, AnyDef> = {
        specific: specificHandler,
        general: generalHandler,
      };
      const resolver = new Resolver(routes, (name) => handlers[name] ?? null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/users/admin')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.routeName).toBe('specific');
    });

    test('matched route with null getRouteHandler → kind: error, logs error', async () => {
      const routes: RoutesMap = {
        home: { path: '/', handler: 'HomeHandler' },
      };
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resolver = new Resolver(routes, () => null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/')));
      expect(res.kind).toBe('error');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('no handler for route'));
      consoleSpy.mockRestore();
    });

    test('route params reach the handler via ctx.getRoute().params', async () => {
      const routes: RoutesMap = {
        item: { path: '/items/:id', handler: 'ItemHandler' },
      };
      const handler = definePage((ctx) => ({
        getRouteDirective: () => {
          const { id } = ctx.getRoute().params as { id: string };
          return id === '42'
            ? { kind: 'ok' }
            : { kind: 'status', code: 404, hasBody: false };
        },
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, () => handler, []);

      const res42 = await withRLS(() => resolver.resolve(makeRequest('/items/42')));
      expect(res42.kind).toBe('response');
      if (res42.kind === 'response') expect(res42.statusCode).toBe(200);

      const res99 = await withRLS(() => resolver.resolve(makeRequest('/items/99')));
      expect(res99.kind).toBe('response');
      if (res99.kind === 'response') expect(res99.statusCode).toBe(404);
    });
  });

  describe('Directive → status / redirect', () => {
    test("{ kind: 'ok' } → status 200, no redirect location", async () => {
      const routes: RoutesMap = { home: { path: '/', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.statusCode).toBe(200);
      expect(res.redirectLocation).toBeUndefined();
    });

    test('non-redirect status directive → statusCode propagates, no redirect location', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'status', code: 503, hasBody: false }),
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.statusCode).toBe(503);
      expect(res.redirectLocation).toBeUndefined();
    });

    test.each([301, 302, 303, 307, 308] as const)(
      'redirect directive (code %i) → statusCode and redirectLocation propagate, no handler',
      async (code) => {
        const routes: RoutesMap = { r: { path: '/r', handler: 'H' } };
        const handler = definePage(() => ({
          getRouteDirective: () => ({ kind: 'redirect', code, location: '/dest' }),
          getElements: () => [],
        }));
        const resolver = new Resolver(routes, () => handler, []);
        const res = await withRLS(() => resolver.resolve(makeRequest('/r')));
        expect(res.kind).toBe('response');
        if (res.kind !== 'response') return;
        expect(res.statusCode).toBe(code);
        expect(res.redirectLocation).toBe('/dest');
        expect(res.handler).toBeUndefined();
      },
    );
  });

  describe('Handler attachment (hasBody logic)', () => {
    test("{ kind: 'ok' } page → handler present", async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.handler).toBeDefined();
    });

    test('status directive with hasBody: false → handler is undefined', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'status', code: 404, hasBody: false }),
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.handler).toBeUndefined();
    });

    test('status directive with hasBody: true → handler present', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'status', code: 404, hasBody: true }),
        getElements: () => [],
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.handler).toBeDefined();
    });

    test('endpoint follows hasBody too: status with hasBody: true → handler present, type endpoint', async () => {
      const routes: RoutesMap = { e: { path: '/e', handler: 'H' } };
      const handler = defineEndpoint(() => ({
        getRouteDirective: () => ({ kind: 'status', code: 404, hasBody: true }),
        getContentType: () => 'application/json',
        getResponseData: () => '{"error":"not found"}',
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/e')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.handler).toBeDefined();
      expect(res.handler?.type).toBe('endpoint');
    });

    test('endpoint status with hasBody: false → handler is undefined', async () => {
      const routes: RoutesMap = { e: { path: '/e', handler: 'H' } };
      const handler = defineEndpoint(() => ({
        getRouteDirective: () => ({ kind: 'status', code: 404, hasBody: false }),
        getContentType: () => 'application/json',
        getResponseData: () => '{"error":"not found"}',
      }));
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/e')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.handler).toBeUndefined();
    });
  });

  describe('Body & redirect guards', () => {
    test.each([204, 304, 100] as const)(
      'body-prohibited status %i with hasBody: true → warns and drops the handler',
      async (code) => {
        const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
        const handler = definePage(() => ({
          getRouteDirective: () => ({ kind: 'status', code, hasBody: true }),
          getElements: () => [],
        }));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const resolver = new Resolver(routes, () => handler, []);
        const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
        expect(res.kind).toBe('response');
        if (res.kind !== 'response') return;
        expect(res.statusCode).toBe(code);
        expect(res.handler).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cannot carry a body'));
        warnSpy.mockRestore();
      },
    );

    test('status directive carrying a redirect code → warns, no redirect location', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'status', code: 302, hasBody: false }),
        getElements: () => [],
      }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.statusCode).toBe(302);
      expect(res.redirectLocation).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('redirect code'));
      warnSpy.mockRestore();
    });
  });

  describe('Proxy directives', () => {
    test('proxy directive → resolves the target route; response reflects the proxied route', async () => {
      const routes: RoutesMap = {
        a: { path: '/a', handler: 'A' },
        b: { path: '/b', handler: 'B' },
      };
      const aHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'b' }),
        getElements: () => [],
      }));
      const bHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const handlers: Record<string, AnyDef> = { a: aHandler, b: bHandler };
      const resolver = new Resolver(routes, (name) => handlers[name] ?? null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/a')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.routeName).toBe('b');
      expect(res.statusCode).toBe(200);
      expect(res.handler).toBeDefined();
    });

    test('proxy directive forwards routeParams to the proxied handler', async () => {
      const routes: RoutesMap = {
        a: { path: '/a', handler: 'A' },
        item: { path: '/items/:id', handler: 'Item' },
      };
      const aHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'item', routeParams: { id: '7' } }),
        getElements: () => [],
      }));
      // resolves to 200 only if the proxied params actually reached this handler
      const itemHandler = definePage((ctx) => ({
        getRouteDirective: () => {
          const { id } = ctx.getRoute().params as { id?: string };
          return id === '7'
            ? { kind: 'ok' }
            : { kind: 'status', code: 404, hasBody: false };
        },
        getElements: () => [],
      }));
      const handlers: Record<string, AnyDef> = { a: aHandler, item: itemHandler };
      const resolver = new Resolver(routes, (name) => handlers[name] ?? null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/a')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.routeName).toBe('item');
      expect(res.statusCode).toBe(200);
    });

    test('proxy chains: a proxied route may itself proxy', async () => {
      const routes: RoutesMap = {
        a: { path: '/a', handler: 'A' },
        b: { path: '/b', handler: 'B' },
        c: { path: '/c', handler: 'C' },
      };
      const aHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'b' }),
        getElements: () => [],
      }));
      const bHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'c' }),
        getElements: () => [],
      }));
      const cHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const handlers: Record<string, AnyDef> = { a: aHandler, b: bHandler, c: cHandler };
      const resolver = new Resolver(routes, (name) => handlers[name] ?? null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/a')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.routeName).toBe('c');
      expect(res.statusCode).toBe(200);
    });

    test('a route proxying itself → kind: error, logs error', async () => {
      const routes: RoutesMap = { self: { path: '/self', handler: 'Self' } };
      const selfHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'self' }),
        getElements: () => [],
      }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resolver = new Resolver(routes, () => selfHandler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/self')));
      expect(res.kind).toBe('error');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cannot proxy itself'));
      errorSpy.mockRestore();
    });

    test('proxy to a non-existent route → kind: error, logs error', async () => {
      const routes: RoutesMap = { a: { path: '/a', handler: 'A' } };
      const aHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'nonexistent' }),
        getElements: () => [],
      }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resolver = new Resolver(routes, (name) => name === 'a' ? aHandler : null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/a')));
      expect(res.kind).toBe('error');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('proxy route does not exist'));
      errorSpy.mockRestore();
    });

    test('proxy to a route that does not accept the request method → kind: error, logs error', async () => {
      const routes: RoutesMap = {
        a: { path: '/a', handler: 'A', method: 'POST' },
        b: { path: '/b', handler: 'B', method: 'GET' },
      };
      const aHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'b' }),
        getElements: () => [],
      }));
      const bHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const handlers: Record<string, AnyDef> = { a: aHandler, b: bHandler };
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resolver = new Resolver(routes, (name) => handlers[name] ?? null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/a', 'POST')));
      expect(res.kind).toBe('error');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not handle HTTP method'));
      errorSpy.mockRestore();
    });

    test('a mutual proxy cycle exceeding max depth → kind: error, logs error', async () => {
      // ping ↔ pong: neither proxies *itself*, so it evades the self-proxy
      // guard and instead exhausts the recursion-depth limit.
      const routes: RoutesMap = {
        ping: { path: '/ping', handler: 'Ping' },
        pong: { path: '/pong', handler: 'Pong' },
      };
      const pingHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'pong' }),
        getElements: () => [],
      }));
      const pongHandler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'proxy', routeName: 'ping' }),
        getElements: () => [],
      }));
      const handlers: Record<string, AnyDef> = { ping: pingHandler, pong: pongHandler };
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resolver = new Resolver(routes, (name) => handlers[name] ?? null, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/ping')));
      expect(res.kind).toBe('error');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('max proxy depth exceeded'));
      errorSpy.mockRestore();
    });
  });

  describe('Errors', () => {
    test('getRouteDirective throws → kind: error, logs error, does not propagate', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => { throw new Error('directive failure'); },
        getElements: () => [],
      }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const resolver = new Resolver(routes, () => handler, []);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('error');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('error during getRouteDirective'),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  describe('Middleware participation', () => {
    test('global middleware wrapping getRouteDirective rewrites the directive', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const rewriteMiddleware = defineMiddleware('all', () => ({
        getRouteDirective: async (next) => {
          await next();
          return { kind: 'status', code: 418, hasBody: false };
        },
      }));
      const resolver = new Resolver(routes, () => handler, [rewriteMiddleware]);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.statusCode).toBe(418);
    });

    test('global middleware short-circuiting getRouteDirective (no next()) overrides handler directive', async () => {
      const routes: RoutesMap = { p: { path: '/p', handler: 'H' } };
      const handler = definePage(() => ({
        getRouteDirective: () => ({ kind: 'ok' }),
        getElements: () => [],
      }));
      const shortCircuitMiddleware = defineMiddleware('all', () => ({
        getRouteDirective: (_next) => ({ kind: 'status', code: 503, hasBody: false }),
      }));
      const resolver = new Resolver(routes, () => handler, [shortCircuitMiddleware]);
      const res = await withRLS(() => resolver.resolve(makeRequest('/p')));
      expect(res.kind).toBe('response');
      if (res.kind !== 'response') return;
      expect(res.statusCode).toBe(503);
    });
  });
});
