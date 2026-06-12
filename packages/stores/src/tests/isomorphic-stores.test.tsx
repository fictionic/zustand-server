// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor as waitForDom } from "@testing-library/react";
import { defineTestIsoStore } from "./helpers/testAdapter";
import {IsoStoreProvider} from "../IsoStoreProvider";

afterEach(cleanup);

// ─── Basic rendering ─────────────────────────────────────────────────────────

test("renders initial state via IsoStoreProvider", () => {
  const CounterStore = defineTestIsoStore<{}, { count: number }>(
    () => () => ({ count: 42 })
  );

  function Widget() {
    const count = CounterStore.hooks.useStore(s => s.count);
    return <div>{count}</div>;
  }

  const store = CounterStore.createStore({});
  render(
    <IsoStoreProvider stores={[store]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("42")).toBeTruthy();
});

test("useStore outside provider throws", () => {
  const SomeStore = defineTestIsoStore<{}, { x: number }>(
    () => () => ({ x: 1 })
  );

  function Widget() {
    const x = SomeStore.hooks.useStore(s => s.x);
    return <div>{x}</div>;
  }

  const originalError = console.error;
  console.error = () => {};
  try {
    expect(() => render(<Widget />)).toThrow("isomorphic-stores: cannot call hooks outside a provider");
  } finally {
    console.error = originalError;
  }
});

// ─── setAsync ───────────────────────────────────────────────────────────────

test("setAsync: initial value shown before promise resolves", async () => {
  let resolveName!: (v: string) => void;
  const NameStore = defineTestIsoStore<{}, { name: string }>(
    (_, { setAsync }) => () => ({
      ...setAsync("name", new Promise<string>(res => { resolveName = res; })),
    })
  );

  const store = NameStore.createStore({});

  function Widget() {
    const name = NameStore.hooks.useStore(s => s.name);
    return <div>{name ?? "loading"}</div>;
  }

  render(
    <IsoStoreProvider stores={[store]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("loading")).toBeTruthy();

  resolveName("Alice");
  await waitForDom(() => screen.getByText("Alice"));
});

test("setAsync: whenReady resolves only after all promises settle", async () => {
  let resolveName!: (v: string) => void;
  let resolveAge!: (v: number) => void;

  const ProfileStore = defineTestIsoStore<{}, { name: string; age: number }>(
    (_, { setAsync }) => () => ({
      ...setAsync("name", new Promise<string>(res => { resolveName = res; })),
      ...setAsync("age", new Promise<number>(res => { resolveAge = res; })),
    })
  );

  const store = ProfileStore.createStore({});
  let resolved = false;
  store.whenReady.then(() => { resolved = true; });

  await act(async () => {});
  expect(resolved).toBe(false);

  resolveName("Alice");
  await act(async () => {});
  expect(resolved).toBe(false);

  resolveAge(30);
  await act(async () => { await store.whenReady; });
  expect(resolved).toBe(true);
});

test("setAsync: rejection triggers onError, keeps initial value, whenReady still resolves", async () => {
  const errors: unknown[] = [];

  const FailStore = defineTestIsoStore<{}, { name: string }>(
    (_, { setAsync }) => () => ({
      ...setAsync("name", Promise.reject(new Error("fetch failed"))),
    }),
    { onError: (e) => errors.push(e) }
  );

  const store = FailStore.createStore({});

  function Widget() {
    const name = FailStore.hooks.useStore(s => s.name);
    return <div>{name ?? "fallback"}</div>;
  }

  await act(async () => {
    render(
      <IsoStoreProvider stores={[store]}>
        <Widget />
      </IsoStoreProvider>
    );
    await store.whenReady;
  });

  expect(screen.getByText("fallback")).toBeTruthy();
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(Error);
  expect((errors[0] as Error).cause).toBeInstanceOf(Error);
  expect(((errors[0] as Error).cause as Error).message).toBe("fetch failed");
});

// ─── Actions ─────────────────────────────────────────────────────────────────

test("actions update state and trigger re-render", async () => {
  const CounterStore = defineTestIsoStore<{}, { count: number; increment: () => void }>(
    () => (set, get) => ({
      count: 0,
      increment: () => set({ count: get().count + 1 }),
    })
  );

  const store = CounterStore.createStore({});

  function Widget() {
    const count = CounterStore.hooks.useStore(s => s.count);
    const increment = CounterStore.hooks.useStore(s => s.increment);
    return <button onClick={increment}>{count}</button>;
  }

  render(
    <IsoStoreProvider stores={[store]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("0")).toBeTruthy();

  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("1")).toBeTruthy();
});

// ─── setNonBlockingAsync ────────────────────────────────────────────────────

test("setNonBlockingAsync: does not contribute to whenReady", async () => {
  let resolveData!: (v: string) => void;

  const DataStore = defineTestIsoStore<{}, { data: string }>(
    (_, { setNonBlockingAsync }) => () => ({
      ...setNonBlockingAsync("data", new Promise<string>(res => { resolveData = res; }), "pending"),
    })
  );

  const store = DataStore.createStore({});
  let whenReadyResolved = false;
  store.whenReady.then(() => { whenReadyResolved = true; });

  await act(async () => {});
  expect(whenReadyResolved).toBe(true); // resolves even though setNonBlockingAsync promise is still pending

  resolveData("loaded"); // resolve it so we don't leak the promise
});

test("setNonBlockingAsync: initial value shown before mount; resolves after mount", async () => {
  let resolveData!: (v: string) => void;

  const DataStore = defineTestIsoStore<{}, { data: string }>(
    (_, { setNonBlockingAsync }) => () => ({
      ...setNonBlockingAsync("data", new Promise<string>(res => { resolveData = res; }), "pending"),
    })
  );

  const store = DataStore.createStore({});

  function Widget() {
    const data = DataStore.hooks.useStore(s => s.data);
    return <div>{data}</div>;
  }

  render(
    <IsoStoreProvider stores={[store]}>
      <Widget />
    </IsoStoreProvider>
  );

  // onMount has fired (useEffect ran), but our promise hasn't resolved yet
  expect(screen.getByText("pending")).toBeTruthy();

  resolveData("loaded");
  await waitForDom(() => screen.getByText("loaded"));
});

// ─── useClientHooks ─────────────────────────────────────────────────────────

test("useCreateClientStore: throws before ready, value after", async () => {
  const SimpleStore = defineTestIsoStore<{}, { value: string }>(
    () => () => ({ value: "hello" })
  );

  function Widget() {
    const [ready, clientHooks] = SimpleStore.useCreateClientStore({});
    const value = clientHooks.useStore(s => s.value);
    if (!ready) return <div>not-ready</div>;
    return <div>{value}</div>;
  }

  render(<Widget />);
  expect(screen.getByText("not-ready")).toBeTruthy();
  await waitForDom(() => screen.getByText("hello"));
});

// ─── broadcast / onMessage ───────────────────────────────────────────────────

test("broadcast delivers message to all mounted instances", async () => {
  type Msg = { type: "rename"; name: string };

  const NameStore = defineTestIsoStore<{}, { name: string }, Msg>(
    (_, { onMessage }) => (set) => {
      onMessage((msg) => {
        if (msg.type === "rename") set({ name: msg.name });
      });
      return { name: "initial" };
    }
  );

  const store1 = NameStore.createStore({});
  const store2 = NameStore.createStore({});

  function Widget({ label }: { label: string }) {
    const name = NameStore.hooks.useStore(s => s.name);
    return <div data-testid={label}>{name}</div>;
  }

  render(
    <>
      <IsoStoreProvider stores={[store1]}><Widget label="w1" /></IsoStoreProvider>
      <IsoStoreProvider stores={[store2]}><Widget label="w2" /></IsoStoreProvider>
    </>
  );

  expect(screen.getAllByText("initial")).toHaveLength(2);

  act(() => {
    NameStore.broadcast({ type: "rename", name: "Bob" });
  });

  expect(screen.getAllByText("Bob")).toHaveLength(2);
});

// ─── Duplicate async keys ─────────────────────────────────────────────────────

test("setAsync: duplicate key throws", () => {
  const Store = defineTestIsoStore<{}, { name: string }>(
    (_, { setAsync }) => () => ({
      ...setAsync("name", Promise.resolve("a")),
      ...setAsync("name", Promise.resolve("b")),
    })
  );

  expect(() => Store.createStore({})).toThrow("duplicate async key");
});

test("setNonBlockingAsync: duplicate key throws", () => {
  const Store = defineTestIsoStore<{}, { data: string }>(
    (_, { setNonBlockingAsync }) => () => ({
      ...setNonBlockingAsync("data", Promise.resolve("a"), ""),
      ...setNonBlockingAsync("data", Promise.resolve("b"), ""),
    })
  );

  expect(() => Store.createStore({})).toThrow("duplicate async key");
});

test("setAsync and setNonBlockingAsync: same key throws", () => {
  const Store = defineTestIsoStore<{}, { name: string }>(
    (_, { setAsync, setNonBlockingAsync }) => () => ({
      ...setAsync("name", Promise.resolve("a")),
      ...setNonBlockingAsync("name", Promise.resolve("b"), ""),
    })
  );

  expect(() => Store.createStore({})).toThrow("duplicate async key");
});

// ─── Multiple stores in one provider ─────────────────────────────────────────

test("IsoStoreProvider wires multiple stores into the same tree", () => {
  const StoreA = defineTestIsoStore<{}, { a: string }>(
    () => () => ({ a: "hello" })
  );
  const StoreB = defineTestIsoStore<{}, { b: string }>(
    () => () => ({ b: "world" })
  );

  const storeA = StoreA.createStore({});
  const storeB = StoreB.createStore({});

  function Widget() {
    const a = StoreA.hooks.useStore(s => s.a);
    const b = StoreB.hooks.useStore(s => s.b);
    return <div>{a} {b}</div>;
  }

  render(
    <IsoStoreProvider stores={[storeA, storeB]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("hello world")).toBeTruthy();
});
