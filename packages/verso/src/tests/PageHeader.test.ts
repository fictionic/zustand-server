// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import {
  getStyleAttrs,
  getScriptAttrs,
  getMetaTagAttrs,
  getLinkTagAttrs,
  getBaseTagAttrs,
  setNodeAttrs,
} from '../core/common/handler/PageHeader.js';
import {
  PAGE_HEADER_LINK_ELEMENT_ATTR,
  PAGE_HEADER_STYLE_ELEMENT_ATTR,
} from '../core/common/constants.js';

describe('getStyleAttrs', () => {
  test('href stylesheet returns link attributes with sentinel and rel', () => {
    const attrs = getStyleAttrs({ href: '/styles.css' });
    expect(attrs).toEqual({
      [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '',
      href: '/styles.css',
      rel: 'stylesheet',
    });
  });

  test('href stylesheet with dataAttr includes data attribute', () => {
    const attrs = getStyleAttrs({ href: '/styles.css', dataAttr: { name: 'data-verso', value: 'x' } });
    expect(attrs).toEqual({
      [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '',
      href: '/styles.css',
      rel: 'stylesheet',
      'data-verso': 'x',
    });
  });

  test('href stylesheet with dataAttr and no value uses empty string', () => {
    const attrs = getStyleAttrs({ href: '/styles.css', dataAttr: { name: 'data-verso' } });
    expect(attrs).toEqual({
      [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '',
      href: '/styles.css',
      rel: 'stylesheet',
      'data-verso': '',
    });
  });

  test('inline stylesheet with media includes media', () => {
    const attrs = getStyleAttrs({ text: 'body { color: red; }', media: 'screen' });
    expect(attrs).toEqual({
      [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '',
      media: 'screen',
    });
  });

  test('inline stylesheet without media returns only sentinel', () => {
    const attrs = getStyleAttrs({ text: 'body { color: red; }' });
    expect(attrs).toEqual({ [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '' });
  });

  test('inline stylesheet with dataAttr includes data attribute', () => {
    const attrs = getStyleAttrs({ text: 'body {}', dataAttr: { name: 'data-hash', value: 'abc123' } });
    expect(attrs).toEqual({
      [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '',
      'data-hash': 'abc123',
    });
  });
});

describe('getScriptAttrs', () => {
  test('src script returns src attribute', () => {
    const attrs = getScriptAttrs({ src: '/app.js' });
    expect(attrs).toMatchObject({ src: '/app.js' });
  });

  test('src script with type includes type', () => {
    const attrs = getScriptAttrs({ src: '/app.js', type: 'module' });
    expect(attrs).toMatchObject({ src: '/app.js', type: 'module' });
  });

  test('src script includes async when true', () => {
    const attrs = getScriptAttrs({ src: '/app.js', async: true });
    expect(attrs).toHaveProperty('async', '');
  });

  test('src script includes defer when true', () => {
    const attrs = getScriptAttrs({ src: '/app.js', defer: true });
    expect(attrs).toHaveProperty('defer', '');
  });

  test('src script omits async when false', () => {
    const attrs = getScriptAttrs({ src: '/app.js', async: false });
    expect(attrs).not.toHaveProperty('async');
  });

  test('src script omits defer when false', () => {
    const attrs = getScriptAttrs({ src: '/app.js', defer: false });
    expect(attrs).not.toHaveProperty('defer');
  });

  test('inline script (text) does not include src', () => {
    const attrs = getScriptAttrs({ text: 'console.log("hi")' });
    expect(attrs).not.toHaveProperty('src');
  });
});

describe('getMetaTagAttrs', () => {
  test('name variant includes name and content', () => {
    const attrs = getMetaTagAttrs({ name: 'description', content: 'A great page' });
    expect(attrs).toEqual({ name: 'description', content: 'A great page' });
  });

  test('property variant includes property and content', () => {
    const attrs = getMetaTagAttrs({ property: 'og:title', content: 'My Title' });
    expect(attrs).toEqual({ property: 'og:title', content: 'My Title' });
  });

  test('httpEquiv variant uses http-equiv attribute name', () => {
    const attrs = getMetaTagAttrs({ httpEquiv: 'refresh', content: '5' });
    expect(attrs).toEqual({ 'http-equiv': 'refresh', content: '5' });
  });

  test('httpEquiv variant does not include name or property', () => {
    const attrs = getMetaTagAttrs({ httpEquiv: 'refresh', content: '5' });
    expect(attrs).not.toHaveProperty('name');
    expect(attrs).not.toHaveProperty('property');
  });
});

describe('getLinkTagAttrs', () => {
  test('minimal link includes sentinel, rel, and href', () => {
    const attrs = getLinkTagAttrs({ rel: 'canonical', href: '/page' });
    expect(attrs).toEqual({
      [PAGE_HEADER_LINK_ELEMENT_ATTR]: '',
      rel: 'canonical',
      href: '/page',
    });
  });

  test('passes through optional fields', () => {
    const attrs = getLinkTagAttrs({
      rel: 'preload',
      href: '/font.woff2',
      as: 'font',
      crossorigin: 'anonymous',
      type: 'font/woff2',
    });
    expect(attrs).toEqual({
      [PAGE_HEADER_LINK_ELEMENT_ATTR]: '',
      rel: 'preload',
      href: '/font.woff2',
      as: 'font',
      crossorigin: 'anonymous',
      type: 'font/woff2',
    });
  });

  test('always includes the sentinel attribute', () => {
    const attrs = getLinkTagAttrs({ rel: 'icon', href: '/favicon.ico' });
    expect(attrs).toHaveProperty(PAGE_HEADER_LINK_ELEMENT_ATTR, '');
  });
});

describe('getBaseTagAttrs', () => {
  test('href only', () => {
    const attrs = getBaseTagAttrs({ href: '/app/' });
    expect(attrs).toEqual({ href: '/app/' });
  });

  test('target only', () => {
    const attrs = getBaseTagAttrs({ target: '_blank' });
    expect(attrs).toEqual({ target: '_blank' });
  });

  test('href and target', () => {
    const attrs = getBaseTagAttrs({ href: '/app/', target: '_blank' });
    expect(attrs).toEqual({ href: '/app/', target: '_blank' });
  });

  test('empty base returns empty attrs', () => {
    const attrs = getBaseTagAttrs({});
    expect(attrs).toEqual({});
  });

  test('explicit undefined fields are omitted', () => {
    const attrs = getBaseTagAttrs({ href: undefined, target: undefined });
    expect(attrs).toEqual({});
  });
});

describe('setNodeAttrs', () => {
  test('applies all string attributes to a DOM node', () => {
    const el = document.createElement('link');
    setNodeAttrs(el, { href: '/style.css' } as any);
    expect(el.getAttribute('href')).toBe('/style.css');
  });

  test('applies multiple attributes', () => {
    const el = document.createElement('meta');
    setNodeAttrs(el, { name: 'viewport', content: 'width=device-width' } as any);
    expect(el.getAttribute('name')).toBe('viewport');
    expect(el.getAttribute('content')).toBe('width=device-width');
  });

  test('applies data attributes', () => {
    const el = document.createElement('link');
    setNodeAttrs(el, { href: '/style.css', 'data-verso': 'true' } as any);
    expect(el.getAttribute('data-verso')).toBe('true');
  });
});
