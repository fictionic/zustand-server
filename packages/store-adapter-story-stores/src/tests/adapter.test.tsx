// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor as waitForDom } from "@testing-library/react";
import { IsoStoreProvider } from "@verso-js/stores";
import { defineStoryStore } from "../story-stores";

afterEach(cleanup);

// ─── Basic rendering ────────────────────────────────────────────────────────

test("renders initial state via IsoStoreProvider", () => {
  const CounterStore = defineStoryStore<{}, { count: number }>(
    () => () => ({ count: 42 })
  );

  const store = CounterStore.createStore({});

  function Widget() {
    const count = CounterStore.hooks.useStory(s => s.count);
    return <div>{count}</div>;
  }

  render(
    <IsoStoreProvider stores={[store]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("42")).toBeTruthy();
});

// ─── setAsync ───────────────────────────────────────────────────────────────

test("setAsync: whenReady resolves after promise settles, state is updated", async () => {
  let resolve!: (v: string) => void;

  const NameStore = defineStoryStore<{}, { name: string }>(
    (_opts, { setAsync }) => () => ({
      ...setAsync("name", new Promise<string>(r => { resolve = r; })),
    })
  );

  const store = NameStore.createStore({});

  function Widget() {
    const name = NameStore.hooks.useStory(s => s.name);
    return <div>{name ?? "empty"}</div>;
  }

  render(
    <IsoStoreProvider stores={[store]}>
      <Widget />
    </IsoStoreProvider>
  );

  resolve("Alice");
  await act(async () => { await store.whenReady; });
  await waitForDom(() => screen.getByText("Alice"));
});

// ─── listen with IsoStoreInstance ────────────────────────────────────────────

test("listen: child blocks on parent's whenReady", async () => {
  let resolveParent!: (v: number) => void;

  const ParentStore = defineStoryStore<{}, { value: number }>(
    (_opts, { setAsync }) => () => ({
      ...setAsync("value", new Promise<number>(r => { resolveParent = r; })),
    })
  );

  const ChildStore = defineStoryStore<
    { parent: ReturnType<typeof ParentStore.createStore> },
    { derived: number }
  >(
    (opts) => ({ listen, update }) => {
      listen(opts.parent, s => s.value, v => update(s => { s.derived = v * 2; }));
      return { derived: 0 };
    }
  );

  const parent = ParentStore.createStore({});
  const child = ChildStore.createStore({ parent });

  let childReady = false;
  child.whenReady.then(() => { childReady = true; });

  // child shouldn't be ready yet — parent hasn't resolved
  await act(async () => {});
  expect(childReady).toBe(false);

  // resolve parent
  resolveParent(21);
  await act(async () => { await parent.whenReady; });
  await act(async () => { await child.whenReady; });
  expect(childReady).toBe(true);
});

test("listen: child receives parent's async state via subscription", async () => {
  let resolveParent!: (v: number) => void;

  const ParentStore = defineStoryStore<{}, { value: number }>(
    (_opts, { setAsync }) => () => ({
      ...setAsync("value", new Promise<number>(r => { resolveParent = r; })),
    })
  );

  const ChildStore = defineStoryStore<
    { parent: ReturnType<typeof ParentStore.createStore> },
    { derived: string }
  >(
    (opts) => ({ listen, update }) => {
      listen(opts.parent, s => s.value, v => update(s => { s.derived = String(v); }));
      return { derived: "" };
    }
  );

  const parent = ParentStore.createStore({});
  const child = ChildStore.createStore({ parent });

  function Widget() {
    const derived = ChildStore.hooks.useStory(s => s.derived);
    return <div>{derived || "waiting"}</div>;
  }

  render(
    <IsoStoreProvider stores={[parent, child]}>
      <Widget />
    </IsoStoreProvider>
  );

  resolveParent(42);
  await act(async () => {
    await parent.whenReady;
    await child.whenReady;
  });

  await waitForDom(() => screen.getByText("42"));
});

test("listen: child reacts to parent updates after initial resolution", async () => {
  const ParentStore = defineStoryStore<{}, { value: number }>(
    () => () => ({ value: 1 })
  );

  const ChildStore = defineStoryStore<
    { parent: ReturnType<typeof ParentStore.createStore> },
    { doubled: number }
  >(
    (opts) => ({ listen, update }) => {
      listen(opts.parent, s => s.value, v => update(s => { s.doubled = v * 2; }));
      return { doubled: 0 };
    }
  );

  const parent = ParentStore.createStore({});
  const child = ChildStore.createStore({ parent });

  await act(async () => {
    await parent.whenReady;
    await child.whenReady;
  });

  function Widget() {
    const doubled = ChildStore.hooks.useStory(s => s.doubled);
    return <div>{doubled}</div>;
  }

  render(
    <IsoStoreProvider stores={[parent, child]}>
      <Widget />
    </IsoStoreProvider>
  );

  // initial value from deferred flush
  expect(screen.getByText("2")).toBeTruthy();

  // update parent
  act(() => {
    parent.nativeStore.update(s => { s.value = 10; });
  });

  expect(screen.getByText("20")).toBeTruthy();
});

test("listen: child listens to multiple async parents", async () => {
  let resolveA!: (v: number) => void;
  let resolveB!: (v: number) => void;

  const StoreA = defineStoryStore<{}, { x: number }>(
    (_opts, { setAsync }) => () => ({
      ...setAsync("x", new Promise<number>(r => { resolveA = r; })),
    })
  );

  const StoreB = defineStoryStore<{}, { y: number }>(
    (_opts, { setAsync }) => () => ({
      ...setAsync("y", new Promise<number>(r => { resolveB = r; })),
    })
  );

  const ChildStore = defineStoryStore<
    { a: ReturnType<typeof StoreA.createStore>, b: ReturnType<typeof StoreB.createStore> },
    { sum: number }
  >(
    (opts) => ({ listen, update }) => {
      listen(opts.a, s => s.x, x => update(s => { s.sum = x + (opts.b.nativeStore.select(s => s.y) ?? 0); }));
      listen(opts.b, s => s.y, y => update(s => { s.sum = (opts.a.nativeStore.select(s => s.x) ?? 0) + y; }));
      return { sum: 0 };
    }
  );

  const a = StoreA.createStore({});
  const b = StoreB.createStore({});
  const child = ChildStore.createStore({ a, b });

  let childReady = false;
  child.whenReady.then(() => { childReady = true; });

  // resolve only one parent — child should still not be ready
  resolveA(10);
  await act(async () => { await a.whenReady; });
  expect(childReady).toBe(false);

  // resolve second parent — now child should be ready
  resolveB(20);
  await act(async () => {
    await b.whenReady;
    await child.whenReady;
  });
  expect(childReady).toBe(true);
});
