import React from 'react';
import {describe, test, expect, vi, beforeEach} from 'vitest';

// Mock tokenizeElements before any imports of the module under test.
// The mock is set per-test to return a synthetic token sequence.
vi.mock('../core/common/tokenizeElements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/common/tokenizeElements')>();
  return {
    ...actual,
    tokenizeElements: vi.fn(),
  };
});

// Mock getAbortPromise so tests don't need RLS initialization.
// Default returns a promise that never resolves; abort tests override it.
vi.mock('../core/common/abort', () => ({
  getAbortPromise: vi.fn(),
}));

import {TOKEN, tokenizeElements, type PageElementToken} from '../core/common/tokenizeElements';
import {Root} from '../core/common/components/Root';
import {PageElementProcessor, type ProcessorOpts} from '../core/common/PageElementProcessor';
import {getAbortPromise} from '../core/common/abort';

const tokenizeElementsMock = vi.mocked(tokenizeElements);
const getAbortPromiseMock = vi.mocked(getAbortPromise);

async function tick(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function rootToken(when: Promise<unknown>): PageElementToken {
  return {
    type: TOKEN.ROOT,
    element: (<Root when={when as Promise<void>}><div /></Root>) as any,
  };
}
function containerOpenToken(): PageElementToken {
  return {type: TOKEN.CONTAINER_OPEN, element: {props: {}} as any};
}
function containerCloseToken(): PageElementToken {
  return {type: TOKEN.CONTAINER_CLOSE};
}
function foldToken(): PageElementToken {
  return {type: TOKEN.THE_FOLD};
}

beforeEach(() => {
  tokenizeElementsMock.mockReset();
  // Default: abort never fires.
  getAbortPromiseMock.mockReturnValue(new Promise<never>(() => {}));
});

function makeProcessor(opts: Partial<ProcessorOpts<string | null>> = {}) {
  return new PageElementProcessor<string | null>({
    renderContainerOpen: opts.renderContainerOpen ?? (() => null),
    renderContainerClose: opts.renderContainerClose ?? (() => null),
    // index is the token-position index (not a root-position index), so for
    // a token sequence like [CO, root, CC], the root's index is 1.
    renderRootElement: opts.renderRootElement ?? ((i) => `R${i}`),
    onLastProcessedRootIndex: opts.onLastProcessedRootIndex ?? (() => {}),
    onProcessedTheFoldIndex: opts.onProcessedTheFoldIndex ?? (() => {}),
    consumeRenderedElements: opts.consumeRenderedElements ?? (() => {}),
  });
}

describe('PageElementProcessor', () => {
  test('single root: processes and consumes after resolution', async () => {
    const dfd = Promise.withResolvers<void>();
    tokenizeElementsMock.mockReturnValue([rootToken(dfd.promise)]);

    const consumed: string[] = [];
    const onLastProcessedRootIndex = vi.fn();
    const processor = makeProcessor({
      onLastProcessedRootIndex,
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);
    await tick();
    expect(consumed).toEqual([]);
    expect(onLastProcessedRootIndex).not.toHaveBeenCalled();

    dfd.resolve();
    await done;

    expect(consumed).toEqual(['R0']);
    expect(onLastProcessedRootIndex).toHaveBeenCalledTimes(1);
    expect(onLastProcessedRootIndex).toHaveBeenCalledWith(0);
  });

  test('roots resolving in order: each consumed progressively', async () => {
    const dfds = [0, 1, 2].map(() => Promise.withResolvers<void>());
    tokenizeElementsMock.mockReturnValue(dfds.map(({promise}) => rootToken(promise)));

    const consumed: string[] = [];
    const processor = makeProcessor({
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    dfds[0]!.resolve();
    await tick();
    expect(consumed).toEqual(['R0']);

    dfds[1]!.resolve();
    await tick();
    expect(consumed).toEqual(['R0', 'R1']);

    dfds[2]!.resolve();
    await done;
    expect(consumed).toEqual(['R0', 'R1', 'R2']);
  });

  test('out of order resolution: drain blocks on first PENDING', async () => {
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    tokenizeElementsMock.mockReturnValue([
      rootToken(d0.promise),
      rootToken(d1.promise),
    ]);

    const consumed: string[] = [];
    const processor = makeProcessor({
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    // Resolve the second root first. The first is still pending, so drain
    // must block — consume should not be called.
    d1.resolve();
    await tick();
    expect(consumed).toEqual([]);

    // Now resolve the first; both should flush in document order.
    d0.resolve();
    await done;
    expect(consumed).toEqual(['R0', 'R1']);
  });

  test('containers and roots: consumed in document order', async () => {
    const d0 = Promise.withResolvers<void>();
    tokenizeElementsMock.mockReturnValue([
      containerOpenToken(),
      rootToken(d0.promise),
      containerCloseToken(),
    ]);

    const consumed: string[] = [];
    const processor = makeProcessor({
      renderContainerOpen: () => 'CO',
      renderContainerClose: () => 'CC',
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    d0.resolve();
    await done;

    // Root is at token-position 1.
    expect(consumed).toEqual(['CO', 'R1', 'CC']);
  });

  test('fold callback is invoked with correct index', async () => {
    tokenizeElementsMock.mockReturnValue([
      containerOpenToken(),
      foldToken(),
    ]);

    const onProcessedTheFoldIndex = vi.fn().mockResolvedValue(undefined);
    const processor = makeProcessor({
      renderContainerOpen: () => 'CO',
      onProcessedTheFoldIndex,
    });

    await processor.process([]);
    expect(onProcessedTheFoldIndex).toHaveBeenCalledTimes(1);
    expect(onProcessedTheFoldIndex).toHaveBeenCalledWith(1);
  });

  test('onProcessTheFold is called only once even when later roots resolve during its await', async () => {
    // Roots resolving while the initial walk is paused on the fold's await
    // re-enter walk() via their .then handlers. The non-reentrant guard
    // (if (walking) return) keeps them from advancing the cursor past the
    // fold and re-invoking onProcessTheFold.
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    const foldDfd = Promise.withResolvers<void>();

    tokenizeElementsMock.mockReturnValue([
      foldToken(),
      rootToken(d0.promise),
      rootToken(d1.promise),
    ]);

    const onProcessedTheFoldIndex = vi.fn().mockReturnValue(foldDfd.promise);
    const processor = makeProcessor({
      onProcessedTheFoldIndex,
    });

    const done = processor.process([]);
    await tick();
    expect(onProcessedTheFoldIndex).toHaveBeenCalledTimes(1);

    // Resolve both roots while the initial walk is awaiting the fold.
    d0.resolve();
    d1.resolve();
    await tick();

    foldDfd.resolve();
    await done;

    expect(onProcessedTheFoldIndex).toHaveBeenCalledTimes(1);
  });

  test('drain race regression: tokens consumed in document order even when later roots resolve during a fold await', async () => {
    // Setup: container_open + fold + two roots + container_close.
    // The fold's onProcessTheFold yields (awaits a deferred). While the
    // initial walk is paused on that await, the two roots resolve and
    // their .then handlers invoke walk() concurrently. The non-reentrant
    // walk() guard keeps them from advancing the cursor past the fold.
    //
    // Correct behavior: when the fold resolves, the initial walk resumes,
    // processes everything in order, and consumes ['CO', 'R2', 'R3', 'CC'].
    //
    // This test guards against a refactor where the fold status is flipped
    // to PROCESSED *before* the await (rather than after), or where the
    // non-reentrant guard is removed. Either change would let concurrent
    // walks barrel past the fold and call consumeRenderedElements with the
    // trailing tokens before the initial walk flushes its buffered 'CO' —
    // giving ['R2', 'R3', 'CC', 'CO'].
    const d0 = Promise.withResolvers<void>();
    const d1 = Promise.withResolvers<void>();
    const foldDfd = Promise.withResolvers<void>();

    tokenizeElementsMock.mockReturnValue([
      containerOpenToken(),
      foldToken(),
      rootToken(d0.promise),
      rootToken(d1.promise),
      containerCloseToken(),
    ]);

    const allConsumed: string[] = [];
    const processor = makeProcessor({
      renderContainerOpen: () => 'CO',
      renderContainerClose: () => 'CC',
      onProcessedTheFoldIndex: () => foldDfd.promise,
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) allConsumed.push(v);
      },
    });

    const done = processor.process([]);
    await tick();
    // The initial walk flushes 'CO' as part of its mid-fold flush, then
    // awaits onProcessTheFold. Below-fold tokens stay pending.
    expect(allConsumed).toEqual(['CO']);

    // Resolve both roots while the fold is still awaiting. Their .then
    // handlers fire concurrent walk calls that are caught by the non-reentrant
    // guard — they cannot advance the cursor past the fold and start consuming
    // below-fold tokens behind the initial walk's back.
    d0.resolve();
    d1.resolve();
    await tick();
    expect(allConsumed).toEqual(['CO']);

    // Once the fold resolves, the initial walk continues past the fold,
    // consumes the trailing tokens in document order, and finishes.
    foldDfd.resolve();
    await done;
    expect(allConsumed).toEqual(['CO', 'R2', 'R3', 'CC']);
  });

  test('fold flushes above-fold roots before invoking onProcessTheFold', async () => {
    // When a single walk pass visits [above-fold root RENDERED, FOLD RENDERED,
    // below-fold root RENDERED] in succession, the above-fold root must be
    // consumed BEFORE onProcessTheFold is awaited. Otherwise the server-side
    // fold callback (which writes bootstrap scripts + hydrateRootsUpTo to the
    // response stream) runs before the above-fold root's HTML has been
    // written, and the client's hydrateRootsUpTo signal fires before that
    // root's DOM has streamed in — silently failing hydration for it.
    //
    // The reachable trigger: a below-fold root's `when` resolves before an
    // above-fold sibling's `when` does. When the above-fold root finally
    // resolves and walk runs, the cursor sees R0, FOLD, R2 all RENDERED at
    // once.
    const dA = Promise.withResolvers<void>();   // above the fold
    const dB = Promise.withResolvers<void>();   // below the fold
    const foldDfd = Promise.withResolvers<void>();

    tokenizeElementsMock.mockReturnValue([
      rootToken(dA.promise),
      foldToken(),
      rootToken(dB.promise),
    ]);

    const events: string[] = [];
    const processor = makeProcessor({
      onProcessedTheFoldIndex: (i) => {
        events.push(`fold(${i}):start`);
        return foldDfd.promise.then(() => { events.push(`fold(${i}):end`); });
      },
      onLastProcessedRootIndex: (i) => { events.push(`onProcessRoot(${i})`); },
      consumeRenderedElements: (rendered) => {
        const labels = rendered.filter((v): v is string => v !== null);
        events.push(`consume(${labels.join(',')})`);
      },
    });

    const done = processor.process([]);

    // Below-fold root resolves first; cursor is still blocked on R0 (PENDING).
    dB.resolve();
    await tick();
    expect(events).toEqual([]);

    // Above-fold root resolves. Walk now sees [R0 RENDERED, FOLD RENDERED,
    // R2 RENDERED] in succession.
    dA.resolve();
    await tick();

    // R0 must be flushed first; then onProcessTheFold called. R2 stays
    // buffered until the fold's await resolves.
    expect(events).toEqual([
      'consume(R0)',
      'onProcessRoot(0)',
      'fold(1):start',
    ]);

    foldDfd.resolve();
    await done;

    expect(events).toEqual([
      'consume(R0)',
      'onProcessRoot(0)',
      'fold(1):start',
      'fold(1):end',
      'consume(R2)',
      'onProcessRoot(2)',
    ]);
  });

  test('abort: pending entries are skipped; rendered entries still flush', async () => {
    const d0 = Promise.withResolvers<void>();   // never resolves
    const d1 = Promise.withResolvers<void>();   // resolved before abort
    const d2 = Promise.withResolvers<void>();   // never resolves
    const abortDfd = Promise.withResolvers<never>();

    getAbortPromiseMock.mockReturnValue(abortDfd.promise);
    tokenizeElementsMock.mockReturnValue([
      rootToken(d0.promise),
      rootToken(d1.promise),
      rootToken(d2.promise),
    ]);

    const consumed: string[] = [];
    const processor = makeProcessor({
      consumeRenderedElements: (rendered) => {
        for (const v of rendered) if (v !== null) consumed.push(v);
      },
    });

    const done = processor.process([]);

    // R1 resolves but R0 is still pending, so drain blocks; nothing consumed.
    d1.resolve();
    await tick();
    expect(consumed).toEqual([]);

    // Abort: R0 and R2 (PENDING) get marked ABORTED. Trailing walk skips them
    // and flushes R1 (RENDERED).
    abortDfd.reject(new Error('aborted'));
    await done;

    expect(consumed).toEqual(['R1']);
  });
});
