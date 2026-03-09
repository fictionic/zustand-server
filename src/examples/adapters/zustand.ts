import {
  createStore as createZustandStore,
  type StoreApi as ZustandStore,
  type StateCreator as ZustandStoreInit,
} from "zustand/vanilla";
import type {Adapter, StoreInit, StoreFactory} from "../../core/adapter";
import {defineIsoStore} from "../../core/define";
import {type OnMessage, type IsoStoreDefinition, type WaitFor} from "../../core/types";

const adapter: Adapter<ZustandStore<any>> = <State>(zStore: ZustandStore<State>) => ({
  getState: () => zStore.getState(),
  setState: (state: Partial<State>) => zStore.setState(state),
  subscribe: zStore.subscribe,
});

export const defineZustandIsoStore = <Opts, State, Message = never>(init: StoreInit<Opts, State, Message, ZustandStoreInit<State>>): IsoStoreDefinition<Opts, State, Message> => {
  const factory: StoreFactory<Opts, State, Message, ZustandStore<State>> = (opts: Opts, waitFor: WaitFor<State>, onMessage: OnMessage<Message>) => {
    const zInit: ZustandStoreInit<State> = init(opts, waitFor, onMessage);
    return createZustandStore<State>(zInit);
  }
  return defineIsoStore(factory, adapter);
};
