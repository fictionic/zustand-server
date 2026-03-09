import {
  createStore as createNativeZustandStore,
  type StoreApi as NativeZustandStore,
  type StateCreator as NativeZustandStoreDefinition,
} from "zustand/vanilla";
import type {Adapter, NativeStateCreator, NativeStoreFactory} from "../adapter";
import {defineStore, type StoreDefinition, type WaitFor} from "../core";

const adapter: Adapter<NativeZustandStore<any>> = <State>(zStore: NativeZustandStore<State>) => ({
  getState: () => zStore.getState(),
  setState: (state: State) => zStore.setState(state),
  subscribe: zStore.subscribe,
});

export const defineZustandIsoStore = <Opts, State>(init: NativeStateCreator<Opts, State, NativeZustandStoreDefinition<State>>): StoreDefinition<Opts, State> => {
  const factory: NativeStoreFactory<Opts, State, NativeZustandStore<State>> = (opts: Opts, waitFor: WaitFor<State>) => {
    const stateCreator = init(opts, waitFor);
    return createNativeZustandStore<State>(stateCreator);
  }
  return defineStore(factory, adapter);
};
