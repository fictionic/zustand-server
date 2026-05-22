import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, test, expect } from 'vitest';
import {
  makeRootComponent,
  ensureRootElement,
  scheduleRootRender,
  useRootData,
  Root,
  type RootElementType,
} from '../core/common/components/Root';
import {
  RootContainer,
  renderContainerOpen,
  renderContainerClose,
} from '../core/common/components/RootContainer';
import { TheFold } from '../core/common/components/TheFold';

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
  test('returns a promise that resolves with the rendered element', async () => {
    const element = <Root>hello</Root> as RootElementType;
    const result = await scheduleRootRender(element);
    expect(React.isValidElement(result)).toBe(true);
    const html = renderToString(result);
    expect(html).toContain('hello');
  });

  test('is delayed by when promise', async () => {
    let resolve!: (v: string) => void;
    const when = new Promise<string>((r) => { resolve = r; });
    const MyRoot = makeRootComponent<{ when?: Promise<string> }>(
      () => null,
      (p) => ({ when: p.when }),
    );
    const element = React.createElement(MyRoot, { when }) as RootElementType;
    let settled = false;
    const promise = scheduleRootRender(element).then((r) => { settled = true; return r; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolve('data');
    await promise;
    expect(settled).toBe(true);
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
    const element = React.createElement(MyRoot, { when }) as RootElementType;
    const rendered = await scheduleRootRender(element);
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
    const element = React.createElement(MyRoot) as RootElementType;
    const rendered = await scheduleRootRender(element);
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

describe('renderContainerOpen', () => {
  test('produces div with id, className, and data attributes', () => {
    const element = (
      <RootContainer id="my-container" className="my-class" data-foo="bar" />
    );
    const html = renderContainerOpen(element, 0);
    expect(html).toContain('id="my-container"');
    expect(html).toContain('class="my-class"');
    expect(html).toContain('data-foo="bar"');
    expect(html).toContain('data-verso-element-token-idx="0"');
    expect(html.endsWith('\n')).toBe(true);
    expect(html).not.toContain('</div>');
  });

  test('uses the supplied index for data-verso-element-token-idx', () => {
    const element = <RootContainer />;
    expect(renderContainerOpen(element, 3)).toContain('data-verso-element-token-idx="3"');
  });
});

describe('renderContainerClose', () => {
  test('produces </div>', () => {
    expect(renderContainerClose()).toBe('</div>\n');
  });
});
