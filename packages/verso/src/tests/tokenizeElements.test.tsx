import { describe, test, expect } from 'vitest';
import { tokenizeElements, TOKEN, type PageElementToken } from '../core/common/tokenizeElements';
import { Root } from '../core/common/components/Root';
import { RootContainer } from '../core/common/components/RootContainer';
import { TheFold } from '../core/common/components/TheFold';

function assertToken<T extends PageElementToken['type']>(
  token: PageElementToken | undefined,
  type: T,
): Extract<PageElementToken, { type: T }> {
  if (!token || token.type !== type) throw new Error(`expected ${type}, got ${token?.type}`);
  return token as Extract<PageElementToken, { type: T }>;
}

describe('elementTokenizer', () => {
  test('<Root> element produces ROOT token', () => {
    const el = <Root><div /></Root>;
    const tokens = tokenizeElements([el]);
    expect(tokens).toHaveLength(1);
    const token = assertToken(tokens[0], TOKEN.ROOT);
    expect(token.element).toBe(el);
  });

  test('bare React element is wrapped in ROOT token via ensureRootElement', () => {
    const bare = <div>bare</div>;
    const tokens = tokenizeElements([bare]);
    expect(tokens).toHaveLength(1);
    const token = assertToken(tokens[0], TOKEN.ROOT);
    expect(token.element.type).toBe(Root);
  });

  test('<TheFold> produces THE_FOLD token', () => {
    const el = <TheFold />;
    const tokens = tokenizeElements([el]);
    expect(tokens).toHaveLength(1);
    assertToken(tokens[0], TOKEN.THE_FOLD);
  });

  test('<RootContainer> produces CONTAINER_OPEN + children + CONTAINER_CLOSE', () => {
    const child = <Root><span /></Root>;
    const container = <RootContainer id="main">{child}</RootContainer>;
    const tokens = tokenizeElements([container]);
    expect(tokens).toHaveLength(3);
    expect(assertToken(tokens[0], TOKEN.CONTAINER_OPEN).element).toBe(container);
    expect(assertToken(tokens[1], TOKEN.ROOT).element.type).toBe(Root);
    assertToken(tokens[2], TOKEN.CONTAINER_CLOSE);
  });

  test('nested containers produce nested open/close pairs', () => {
    const rootEl = <Root><span /></Root>;
    const inner = <RootContainer id="inner">{rootEl}</RootContainer>;
    const outer = <RootContainer id="outer">{inner}</RootContainer>;
    const tokens = tokenizeElements([outer]);
    expect(tokens).toHaveLength(5);
    expect(assertToken(tokens[0], TOKEN.CONTAINER_OPEN).element).toBe(outer);
    // inner is cloned by React.Children.toArray so identity differs; check props instead
    expect(assertToken(tokens[1], TOKEN.CONTAINER_OPEN).element.props.id).toBe('inner');
    expect(assertToken(tokens[2], TOKEN.ROOT).element.type).toBe(Root);
    assertToken(tokens[3], TOKEN.CONTAINER_CLOSE);
    assertToken(tokens[4], TOKEN.CONTAINER_CLOSE);
  });

  test('mixed elements preserve order', () => {
    const root1 = <Root><div /></Root>;
    const root2 = <Root><div /></Root>;
    const tokens = tokenizeElements([root1, <TheFold />, root2]);
    expect(tokens).toHaveLength(3);
    expect(assertToken(tokens[0], TOKEN.ROOT).element).toBe(root1);
    assertToken(tokens[1], TOKEN.THE_FOLD);
    expect(assertToken(tokens[2], TOKEN.ROOT).element).toBe(root2);
  });

  test('empty container produces CONTAINER_OPEN + CONTAINER_CLOSE only', () => {
    const container = <RootContainer id="empty" />;
    const tokens = tokenizeElements([container]);
    expect(tokens).toHaveLength(2);
    expect(assertToken(tokens[0], TOKEN.CONTAINER_OPEN).element).toBe(container);
    assertToken(tokens[1], TOKEN.CONTAINER_CLOSE);
  });
});
