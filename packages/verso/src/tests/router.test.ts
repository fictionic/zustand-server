import { describe, test, expect } from 'vitest';
import { createRouter } from '../core/common/router';
import type { RoutesMap } from '../build/config';

describe('Router', () => {
  test('static path matches exactly', () => {
    const routes: RoutesMap = {
      about: { path: '/about', handler: 'AboutHandler' },
    };
    const router = createRouter(routes);
    const result = router.matchRoute('/about', 'GET');
    expect(result).not.toBeNull();
    expect(result?.routeName).toBe('about');
    expect(result?.handler).toBe('AboutHandler');
  });

  test('parameterized path extracts params', () => {
    const routes: RoutesMap = {
      userDetail: { path: '/users/:id', handler: 'UserHandler' },
    };
    const router = createRouter(routes);
    const result = router.matchRoute('/users/42', 'GET');
    expect(result).not.toBeNull();
    expect(result?.routeName).toBe('userDetail');
    expect(result?.params).toMatchObject({ id: '42' });
  });

  test('no match returns null', () => {
    const routes: RoutesMap = {
      about: { path: '/about', handler: 'AboutHandler' },
    };
    const router = createRouter(routes);
    const result = router.matchRoute('/missing', 'GET');
    expect(result).toBeNull();
  });

  test('first-match-wins with overlapping routes', () => {
    const routes: RoutesMap = {
      specific: { path: '/users/admin', handler: 'AdminHandler' },
      general: { path: '/users/:id', handler: 'UserHandler' },
    };
    const router = createRouter(routes);
    const result = router.matchRoute('/users/admin', 'GET');
    expect(result?.routeName).toBe('specific');
    expect(result?.handler).toBe('AdminHandler');
  });

  test('default method is GET when not specified', () => {
    const routes: RoutesMap = {
      about: { path: '/about', handler: 'AboutHandler' },
    };
    const router = createRouter(routes);
    expect(router.matchRoute('/about', 'GET')).not.toBeNull();
  });

  test('route with method POST does not match GET request', () => {
    const routes: RoutesMap = {
      submit: { path: '/submit', handler: 'SubmitHandler', method: 'POST' },
    };
    const router = createRouter(routes);
    expect(router.matchRoute('/submit', 'GET')).toBeNull();
  });

  test('route with method array matches both methods', () => {
    const routes: RoutesMap = {
      form: { path: '/form', handler: 'FormHandler', method: ['GET', 'POST'] },
    };
    const router = createRouter(routes);
    expect(router.matchRoute('/form', 'GET')).not.toBeNull();
    expect(router.matchRoute('/form', 'POST')).not.toBeNull();
  });

  test('method matching is case-insensitive', () => {
    const routes: RoutesMap = {
      about: { path: '/about', handler: 'AboutHandler' },
    };
    const router = createRouter(routes);
    expect(router.matchRoute('/about', 'get')).not.toBeNull();
    expect(router.matchRoute('/about', 'Get')).not.toBeNull();
  });

  test('empty routes map returns null on any path', () => {
    const routes: RoutesMap = {};
    const router = createRouter(routes);
    expect(router.matchRoute('/about', 'GET')).toBeNull();
  });
});
