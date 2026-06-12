import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// A minimal reactive store framework — a tiny zustand stand-in with ZERO
// dependency on @verso-js/stores. It is deliberately self-contained so its
// behavior (state, reactivity, subscribe/notify) can be reasoned about in
// isolation. The iso-stores bridge for it lives separately in ./testAdapter.
//
// Pure React + plain JS. No zustand / redux / valtio.
// ---------------------------------------------------------------------------

export interface TestStore<State> {
  getState: () => State;
  setState: (partial: Partial<State>) => void;
  subscribe: (listener: () => void) => () => void;
}

/** StateCreator (zustand-shaped): receives set/get so actions can mutate, returns initial state. */
export type TestStoreCreator<State> = (
  set: (partial: Partial<State>) => void,
  get: () => State,
) => State;

/** Create a reactive store. `setState` merges and notifies every subscriber. */
export function createTestStore<State extends object>(creator: TestStoreCreator<State>): TestStore<State> {
  let state = {} as State;
  const listeners = new Set<() => void>();

  const getState = () => state;
  const setState = (partial: Partial<State>) => {
    state = { ...state, ...partial };
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  // seed initial state, threading set/get to the creator (so actions can close over them).
  state = creator(setState, getState);

  return { getState, setState, subscribe };
}

/** React binding: subscribe to a selected slice; re-renders on any store change. */
export function useTestStore<State, U>(store: TestStore<State>, selector: (s: State) => U): U {
  const getSnapshot = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
