import type {OnMessage, WaitFor} from "./types";

// adapts a native store into a format that the library can use
export interface Adapter<State, NativeStore, NativeHook, NativeClientHook> {
  getSetState: (nativeStore: NativeStore) => ((state: Partial<State>) => void);
  getHook: (getNativeStore: () => NativeStore) => NativeHook;
  getClientHook: (getNativeStore: () => NativeStore, ready: boolean) => NativeClientHook;
  getEmpty: () => NativeStore;
};

// The outer layer of the two-layer factory pattern -- what the user writes when defining a store.
// Receives opts, waitFor, and onMessage; returns the framework's native inner creator
// (e.g. Zustand's StateCreator, Redux's reducer factory).
export type StoreInit<Opts, State, Message, NativeStoreInit> = (opts: Opts, waitFor: WaitFor<State>, onMessage: OnMessage<Message>) => NativeStoreInit;

// The function that defineStore consumes -- takes opts/waitFor/onMessage and returns an actual
// native store instance. Adapters produce this by wrapping a StoreInit with the native
// store construction call (e.g. createStore, createNativeZustandStore).
export type NativeStoreFactory<Opts, State, Message, NativeStore> = (opts: Opts, waitFor: WaitFor<State>, onMessage: OnMessage<Message>) => NativeStore;
