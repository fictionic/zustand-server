import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import {
  makeRootComponent,
  ensureRootElement,
  scheduleRootRender,
  useRootData,
  Root,
  type AnyRootElement,
} from '../core/common/components/Root';
import {
  RootContainer,
} from '../core/common/components/RootContainer';
import { TheFold } from '../core/common/components/TheFold';
import { PAGE_ELEMENT_TOKEN_IDX_ATTR } from '../core/common/constants';
import {renderContainerCloseToString, renderContainerOpenToString} from '../core/server/renderElement';

describe('makeRootComponent', () => {
  test('attaches ROOT_COMPONENT symbol; result is detected by ensureRootElement', () => {
    const MyFC: React.FC<{ when?: Promise<unknown> }> = () => null;
    const MyRoot = makeRootComponent(MyFC, (p) => ({ when: p.when }));
    const element = React.createElement(MyRoot);
    const ensured = ensureRootElement(element);
    expect(ensured).toBe(element);
  });

  test('plain element is not detected and gets wrapped in Root by ensureRootElement', () => {
    const plain = <div>hello</div>;
    const ensured = ensureRootElement(plain);
    expect(ensured.type).toBe(Root);
  });
});

describe('scheduleRootRender', () => {
  test('returns { promise, attrs }; promise resolves with the rendered element', async () => {
    const element = <Root>hello</Root> as AnyRootElement;
    const { promise, attrs } = scheduleRootRender(element);
    expect(attrs).toBeDefined();
    const resolved = await promise;
    expect(React.isValidElement(resolved)).toBe(true);
    const html = renderToString(resolved);
    expect(html).toContain('hello');
  });

  test('promise is delayed by when', async () => {
    let resolve!: (v: string) => void;
    const when = new Promise<string>((r) => { resolve = r; });
    const MyRoot = makeRootComponent<{ when?: Promise<string> }>(
      () => null,
      (p) => ({ when: p.when }),
    );
    const element = React.createElement(MyRoot, { when }) as AnyRootElement;
    let settled = false;
    const promise = scheduleRootRender(element).promise.then((r) => { settled = true; return r; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolve('data');
    await promise;
    expect(settled).toBe(true);
  });

  test('attrs surfaces renderable html props returned by deriveRootProps', () => {
    const MyRoot = makeRootComponent<{ label: string }>(
      () => null,
      (p) => ({ id: p.label, className: 'my-class', 'data-foo': 'bar' }),
    );
    const element = React.createElement(MyRoot, { label: 'my-id' }) as AnyRootElement;
    const { attrs } = scheduleRootRender(element);
    expect(attrs).toEqual({ id: 'my-id', className: 'my-class', 'data-foo': 'bar' });
  });

  test('when is stripped from attrs', () => {
    const when = Promise.resolve('x');
    const MyRoot = makeRootComponent<{ when?: Promise<string> }>(
      () => null,
      (p) => ({ when: p.when, id: 'x' }),
    );
    const element = React.createElement(MyRoot, { when }) as AnyRootElement;
    const { attrs } = scheduleRootRender(element);
    expect(attrs).not.toHaveProperty('when');
    expect(attrs).toEqual({ id: 'x' });
  });
});

describe('useRootData', () => {
  test('inside a root with when returns the resolved value', async () => {
    const payload = { foo: 'bar' };
    const when = Promise.resolve(payload);
    let captured: unknown;

    const Capturer: React.FC = () => {
      captured = useRootData<typeof payload>();
      return null;
    };
    const MyRoot = makeRootComponent<{ when?: Promise<typeof payload> }>(
      () => <Capturer />,
      (p) => ({ when: p.when }),
    );
    const element = React.createElement(MyRoot, { when }) as AnyRootElement;
    const rendered = await scheduleRootRender(element).promise;
    renderToString(rendered);
    expect(captured).toEqual(payload);
  });

  test('inside a root without when returns undefined', async () => {
    let captured: unknown = 'initial';

    const Capturer: React.FC = () => {
      captured = useRootData();
      return null;
    };
    const MyRoot = makeRootComponent<object>(
      () => <Capturer />,
      () => ({}),
    );
    const element = React.createElement(MyRoot) as AnyRootElement;
    const rendered = await scheduleRootRender(element).promise;
    renderToString(rendered);
    expect(captured).toBeUndefined();
  });
});

describe('RootContainer', () => {
  test('throws when rendered via React', () => {
    expect(() => renderToString(<RootContainer />)).toThrow();
  });
});

describe('TheFold', () => {
  test('throws when rendered via React', () => {
    expect(() => renderToString(<TheFold />)).toThrow();
  });
});

describe('renderContainerOpenToString', () => {
  test('produces div with id, className, and data attributes', () => {
    const html = renderContainerOpenToString(0, {
      id: 'my-container',
      className: 'my-class',
      'data-foo': 'bar',
    });
    expect(html).toContain('id="my-container"');
    expect(html).toContain('class="my-class"');
    expect(html).toContain('data-foo="bar"');
    expect(html).toContain(`${PAGE_ELEMENT_TOKEN_IDX_ATTR}="0"`);
    expect(html.endsWith('\n')).toBe(true);
    expect(html).not.toContain('</div>');
  });

  test(`uses the supplied index for ${PAGE_ELEMENT_TOKEN_IDX_ATTR}`, () => {
    expect(renderContainerOpenToString(3, {})).toContain(`${PAGE_ELEMENT_TOKEN_IDX_ATTR}="3"`);
  });
});

describe('renderContainerCloseToString', () => {
  test('produces </div>', () => {
    expect(renderContainerCloseToString()).toBe('</div>\n');
  });
});
