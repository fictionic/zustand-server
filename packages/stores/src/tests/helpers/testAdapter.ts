import { defineIsoStore } from "../../core/define";
import { type Adapter, type IsoStoreInit } from "../../core/types";
import { createTestStore, useTestStore, type TestStore, type TestStoreCreator } from "./testStore";

// ---------------------------------------------------------------------------
// The @verso-js/stores adapter for the minimal store framework in ./testStore.
//
// A thin bridge: it maps the `Adapter` contract onto createTestStore /
// useTestStore. The reactive store behavior lives in ./testStore and is not
// re-described here. Test-only: NOT exported from the package index.
//
// It exists so stores' own unit tests can drop the @verso-js/store-adapter-zustand
// dependency (removing the stores <-> zustand cycle and the source-vs-dist
// duplicate-instance hazard), and to back e2e infra tests.
// ---------------------------------------------------------------------------

// The native-store init the iso-store core hands the adapter is exactly a store creator.
export type TestNativeStoreInit<State> = TestStoreCreator<State>;

export interface TestHooks<State> {
  useStore: <U>(selector: (s: State) => U) => U;
}

export interface TestClientHooks<State> {
  useStore: <U>(selector: (s: State) => U) => U | undefined;
}

export function makeTestAdapter<State extends object>(): Adapter<
  State,
  TestStore<State>,
  TestNativeStoreInit<State>,
  TestHooks<State>,
  TestClientHooks<State>
> {
  const empty = createTestStore<State>(() => ({}) as State);

  return {
    createNativeStore: (init) => createTestStore(init),
    getSetState: (store) => store.setState,
    useHooks: (useNativeStore) => ({
      useStore: (selector) => useTestStore(useNativeStore(), selector),
    }),
    useClientHooks: (useNativeStore, ready) => ({
      // pre-hydration reads come from the empty store and surface as undefined.
      useStore: (selector) => {
        const value = useTestStore(ready ? useNativeStore() : empty, selector);
        return ready ? value : undefined;
      },
    }),
    empty,
  };
}

/**
 * Convenience wrapper mirroring `defineZustandIsoStore`: pins `Opts`/`State`/
 * `Message` and supplies the test adapter, letting the hooks types infer.
 */
export const defineTestIsoStore = <Opts, State extends object, Message = never>(
  isoInit: IsoStoreInit<Opts, State, Message, TestNativeStoreInit<State>>,
  options?: { onError?: (error: unknown) => void },
) => defineIsoStore(isoInit, makeTestAdapter<State>(), options);
