import type {AdaptedStore, WaitFor} from "./core";

// adapts a store into a format that the library can use
export type Adapter<NativeStore> = <State>(nativeStore: NativeStore) => AdaptedStore<State>;

export type NativeStateCreator<Opts, State, NativeState> = (opts: Opts, waitFor: WaitFor<State>) => NativeState;

export type NativeStoreFactory<Opts, State, NativeStore> = (opts: Opts, waitFor: WaitFor<State>) => NativeStore;
