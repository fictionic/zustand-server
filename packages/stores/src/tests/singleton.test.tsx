// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { act, cleanup, render, screen, waitFor as waitForDom } from "@testing-library/react";
import { defineZustandIsoStore } from "@verso-js/store-adapter-zustand";
import { IsoStoreProvider } from "../IsoStoreProvider";
import { asSingleton } from "../singleton";
import {withRLS} from "@verso-js/verso/testing";

afterEach(() => {
  cleanup();
});

// ─── createStore ────────────────────────────────────────────────────────────

test("createStore creates a store instance", withRLS(() => {
  const Store = asSingleton(
    defineZustandIsoStore<{}, { count: number }>(
      () => () => ({ count: 42 })
    )
  );

  const instance = Store.createStore({});
  expect(instance).toBeTruthy();
  expect(instance.nativeStore).toBeTruthy();
}));

test("createStore throws on second call", withRLS(() => {
  const Store = asSingleton(
    defineZustandIsoStore<{}, { x: number }>(
      () => () => ({ x: 1 })
    )
  );

  Store.createStore({});
  expect(() => Store.createStore({})).toThrow("cannot create more than one instance of a singleton store!");
}));

// ─── hooks ──────────────────────────────────────────────────────────────────

test("hooks access store through provider context", withRLS(() => {
  const Store = asSingleton(
    defineZustandIsoStore<{}, { name: string }>(
      () => () => ({ name: "Alice" })
    )
  );

  const instance = Store.createStore({});

  function Widget() {
    const name = Store.hooks.useStore(s => s.name);
    return <div>{name}</div>;
  }

  render(
    <IsoStoreProvider stores={[instance]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("Alice")).toBeTruthy();
}));

// ─── useClientHooks ─────────────────────────────────────────────────────────

test("useClientHooks throws if no singleton has been created", withRLS(() => {
  const Store = asSingleton(
    defineZustandIsoStore<{}, { x: number }>(
      () => () => ({ x: 1 })
    )
  );

  function Widget() {
    const [, clientHooks] = Store.useClientHooks();
    const x = clientHooks.useStore(s => s.x);
    return <div>{x}</div>;
  }

  const originalError = console.error;
  console.error = () => {};
  try {
    expect(() => render(<Widget />)).toThrow("no singleton instance has been created");
  } finally {
    console.error = originalError;
  }
}));

test("useClientHooks: returns not ready initially, then ready after whenReady", withRLS(async () => {
  let resolveName!: (v: string) => void;
  const Store = asSingleton(
    defineZustandIsoStore<{}, { name: string }>(
      (_, { setAsync }) => () => ({
        ...setAsync("name", new Promise<string>(res => { resolveName = res; })),
      })
    )
  );

  Store.createStore({});

  function Widget() {
    const [ready, clientHooks] = Store.useClientHooks();
    const name = clientHooks.useStore(s => s.name);
    return <div>{ready ? name : "not-ready"}</div>;
  }

  render(<Widget />);
  expect(screen.getByText("not-ready")).toBeTruthy();

  await act(async () => { resolveName("Alice"); });
  await waitForDom(() => screen.getByText("Alice"));
}));

test("useClientHooks: works without provider (cross-root access)", withRLS(async () => {
  const Store = asSingleton(
    defineZustandIsoStore<{}, { value: string }>(
      () => () => ({ value: "hello" })
    )
  );

  Store.createStore({});

  function Widget() {
    const [ready, clientHooks] = Store.useClientHooks();
    const value = clientHooks.useStore(s => s.value);
    if (!ready) return <div>waiting</div>;
    return <div>{value}</div>;
  }

  // No IsoStoreProvider — useClientHooks accesses the singleton via RLS
  render(<Widget />);

  await waitForDom(() => screen.getByText("hello"));
}));

// ─── message ────────────────────────────────────────────────────────────────

test("message broadcasts to mounted singleton instances", withRLS(async () => {
  type Msg = { type: "rename"; name: string };

  const Store = asSingleton(
    defineZustandIsoStore<{}, { name: string }, Msg>(
      (_, { onMessage }) => (set) => {
        onMessage((msg) => {
          if (msg.type === "rename") set({ name: msg.name });
        });
        return { name: "initial" };
      }
    )
  );

  const instance = Store.createStore({});

  function Widget() {
    const name = Store.hooks.useStore(s => s.name);
    return <div>{name}</div>;
  }

  render(
    <IsoStoreProvider stores={[instance]}>
      <Widget />
    </IsoStoreProvider>
  );

  expect(screen.getByText("initial")).toBeTruthy();

  act(() => {
    Store.message({ type: "rename", name: "Bob" });
  });

  expect(screen.getByText("Bob")).toBeTruthy();
}));
