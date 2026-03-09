import type {AdaptedStore, OnMessage, WaitFor} from "./types";

// adapts a store into a format that the library can use
export type Adapter<NativeStore> = <State>(nativeStore: NativeStore) => AdaptedStore<State>;

// The outer layer of the two-layer factory pattern — what the user writes when defining a store.
// Receives opts, waitFor, and onMessage; returns the framework's native inner creator
// (e.g. Zustand's StateCreator, Redux's reducer factory).
export type StoreInit<Opts, State, Message = never, NativeStoreInit = never> = (opts: Opts, waitFor: WaitFor<State>, onMessage: OnMessage<Message>) => NativeStoreInit;

// The function that defineStore consumes — takes opts/waitFor/onMessage and returns an actual
// native store instance. Adapters produce this by wrapping a StoreInit with the native
// store construction call (e.g. createStore, createNativeZustandStore).
export type StoreFactory<Opts, State, Message = never, NativeStore = never> = (opts: Opts, waitFor: WaitFor<State>, onMessage: OnMessage<Message>) => NativeStore;
