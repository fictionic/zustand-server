# zustand-server

> **⚠️ This is an untested sketch. Not ready for use.**

A state management library designed for SSR frameworks that stream server-rendered content — motivated by dissatisfaction with React's direction of enforcing Suspense as the only model for async server rendering.

## Motivation

At Redfin we used [react-server](https://github.com/redfin/react-server), an SSR framework designed to provide highly performant server rendering. It does this by encouraging you to write pages as a series of "root elements" that each declare their own asynchronous data dependencies: then the server render starts data fetching as soon as possible and streams down each root element as they become ready. Contrast with what modern React encourages: every page declares Suspense boundaries, but only one data payload can hold up the server render--everything else streams in after the first client render. This often leads to a bad user experience and much worse SEO performance.

The catch with a framework like React-Server is that it requires a specific kind of state management: stores must be **multiply-instantiable** (created per-request, not declared as module-level singletons) to avoid cross-request contamination. Redfin's approach, having been decided around 2014 or so, was based on the Reflux pattern, which has a number of pitfalls.

Having enjoyed working with [Zustand](https://github.com/pmndrs/zustand), I wanted to try wrapping it to work in a react-server-like environment, where:

- Stores are created per-request rather than as module singletons
- Stores declare their async data dependencies upfront, which an SSR framework can use to hold up the server render
- Components select into stores with a hook, just like plain Zustand
- Store creation can be deferred until client render if needed (e.g. if an expensive data call isn't SEO critical)

This is what I ended up with after a few days of exploration.

## Design

The core is framework-agnostic — it defines the `waitFor`/`whenReady` protocol and the adapter interface. The Zustand adapter is provided as a reference implementation. Any store-based framework with `getState`/`setState`/`subscribe` semantics could have an adapter written for it.

Store definitions use a two-layer factory pattern:

```ts
defineZustandIsoStore<MyOpts, MyState>(
  ({ userId }, waitFor) => (                     // outer: opts + waitFor (library layer)
    (set, get) => ({                             // inner: Zustand StateCreator (framework layer)
      ...waitFor('name', fetchName(userId), ''), // declares a dependency on fetchName.
      setName: (name) => set({ name }),          //  the state will update with the resolved value
    })
  )
);
```

The SSR integration is left to the call site — `zustand-server` has no dependency on react-server or any specific SSR framework:

```tsx
// in handleRoute / getElements (react-server)
const store = MyStore.createStore({ userId: 1 });
return (
  <RootElement when={() => store.whenReady}>
    <MyStore.StoreProvider instance={store}>
      <Widget />
    </MyStore.StoreProvider>
  </RootElement>
);

// in a component
const name = MyStore.useStore(s => s.name);

// in a client-only component
const { ready, useClientStore } = MyStore.useCreateClientStore({ userId: 1 });
const name = useClientStore(s => s.name); // null until ready
```
