import { test } from 'vitest';
import type { ReactElement } from 'react';
import { getPass } from './pass';

/**
 * Assert that a component hydrates cleanly — i.e. the server render and the
 * client render agree, so React won't throw away the server markup.
 *
 * Runs only in the `hydration` project (see versoProjects), which uses jsdom and
 * — crucially — does NOT statically define `IS_SERVER`, leaving it a runtime
 * global this helper flips across the two phases:
 *
 *  1. server phase: `IS_SERVER = true`, render to HTML via `renderToString`
 *     (exactly what Verso does on the server).
 *  2. client phase: `IS_SERVER = false`, hydrate that markup with real ReactDOM.
 *
 * Any hydration mismatch React reports (`onRecoverableError`) fails the test.
 * Gating is by runtime pass, not filename: testHydration() runs only in the
 * hydration pass and self-skips in the server/client passes.
 *
 * `render` is invoked once per phase, so environment branching at element-
 * construction time is exercised too — not just branching inside components.
 */
export function testHydration(desc: string, render: () => ReactElement): void {
  if (getPass() !== 'hydration') {
    return;
  }
  test(desc, async () => {
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    const { act } = await import('react');

    // server phase
    globalThis.IS_SERVER = true;
    const html = renderToString(render());

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    // client phase
    globalThis.IS_SERVER = false;
    const mismatches: Error[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, render(), {
        onRecoverableError: (error) => mismatches.push(error as Error),
      });
    });
    await act(async () => {
      root.unmount();
    });
    container.remove();

    if (mismatches.length > 0) {
      throw new Error(
        `hydration mismatch in "${desc}":\n` +
          mismatches.map((e) => `  - ${e.message}`).join('\n'),
      );
    }
  });
}
