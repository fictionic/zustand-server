import {
  createStore as createNativeZustandStore,
  type StoreApi as NativeZustandStore,
  type StateCreator as NativeZustandStoreInit,
} from "zustand/vanilla";
import { useStore as useNativeZustandStore } from "zustand/react";
import {
  defineIsoStore,
  type StoreInit,
  type NativeStoreFactory,
} from "../../adapter";

const emptyZStore = createNativeZustandStore<Record<string, never>>(() => ({}));

export const defineZustandIsoStore = <Opts, State, Message = never>(
  init: StoreInit<Opts, State, Message, NativeZustandStoreInit<State>>
) => {
  type ZustandStoreFactory = NativeStoreFactory<Opts, State, Message, NativeZustandStore<State>>;
  const factory: ZustandStoreFactory = (opts, waitFor, onMessage) => createNativeZustandStore<State>(init(opts, waitFor, onMessage));

  const getHook = (getNativeStore: () => NativeZustandStore<State>) => <U>(selector: (s: State) => U): U => useNativeZustandStore(getNativeStore(), selector);

  return defineIsoStore(factory, {
    getSetState: (nativeStore: NativeZustandStore<State>) => (
      (state: Partial<State>) => nativeStore.setState(state)
    ),
    getHook,
    getClientHook: (getNativeStore: () => NativeZustandStore<State>, ready: boolean) => (
      <U>(selector: (s: State) => U): U | undefined => {
        const hook = getHook(getNativeStore);
        const value = hook(selector);
        return ready ? value : undefined;
      }
    ),
    getEmpty: () => emptyZStore as unknown as NativeZustandStore<State>,
  });
};
