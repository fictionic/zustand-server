import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {Adapter, NativeStoreFactory} from "./adapter";
import {getStoreProvider} from "./StoreProvider";

export interface AdaptedStore<State> {
  getState: () => State;
  setState: (state: Partial<State>) => void;
  subscribe: (listener: (() => void)) => (() => void);
}

export interface StoreInstance<State> {
  adaptedStore: AdaptedStore<State>;
  whenReady: Promise<void>;
}

export type StoreProvider<State> = React.FC<{ instance: StoreInstance<State>, children: ReactNode }>;
export type UseStore<State> = <T>(selector: (state: State) => T) => T;
export type UseClientStore<State> = <T>(selector: (state: State) => T) => T | null;
export type UseCreateClientStore<Opts, State> = (opts: Opts) => {
  ready: boolean;
  useClientStore: UseClientStore<State>;
};

export interface StoreDefinition<Opts, State> {
  // use these to wire up a store to the root of a page
  createStore: (opts: Opts) => StoreInstance<State>
  StoreProvider: StoreProvider<State>;
  // use this to select from a wired-up store from a component anywhere underneath
  useStore: UseStore<State>;
  // use this to create and select from a store after the first client render
  useCreateClientStore: UseCreateClientStore<Opts, State>;
}

export type WaitFor<State> = <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => { [key in K]: V };

function makeWaitFor<State>(pending: Array<{name: keyof State, promise: Promise<unknown>}>): WaitFor<State> {
  return <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => {
    pending.push({ name, promise });
    return { [name]: initialValue } as { [key in K]: V };
  };
}

export const defineStore = <Opts, State, NativeStore>(
  factory: NativeStoreFactory<Opts, State, NativeStore>,
  adapter: Adapter<NativeStore>,
) => {
  const createStore = (opts: Opts) => {
    type PendingValue = { name: keyof State, promise: Promise<unknown> };
    const pending: Array<PendingValue> = [];
    const waitFor = makeWaitFor<State>(pending);
    const nativeStore = factory(opts, waitFor);
    const adaptedStore = adapter<State>(nativeStore);
    const whenReady = Promise.all(pending.map(async ({ name, promise }) => {
      const value = await promise;
      adaptedStore.setState({ [name]: value } as Partial<State>);
    })).then(() => {});
    return {
      adaptedStore,
      whenReady,
    };
  };

  const context = createContext<AdaptedStore<State> | null>(null);

  const useStore: UseStore<State> = (selector) => {
    const adaptedStore = useContext(context)
    const { subscribe, getState } = adaptedStore!;
    const getSnapshot = useCallback(() => selector(getState()), [selector]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };

  const useCreateClientStore: UseCreateClientStore<Opts, State> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    const instanceRef = useRef<StoreInstance<State> | null>(null);

    useEffect(() => {
      const instance = createStore(opts);
      instance.whenReady.then(() => {
        setReady(true);
      });
      instanceRef.current = instance;
    }, []);

    const useClientStore: UseClientStore<State> = (selector) => {
      const emptyStore = useMemo(() => ({
        subscribe: () => (() => {}),
        getState: () => null,
      }), []);
      const getRealSnapshot = useCallback(() => {
        return selector(instanceRef.current!.adaptedStore.getState())
      }, [selector]);
      const [subscribe, getSnapshot] = useMemo(() => {
        if (!ready) {
          return [emptyStore.subscribe, emptyStore.getState];
        } else {
          const adaptedStore = instanceRef.current!.adaptedStore;
          return [adaptedStore.subscribe, getRealSnapshot];
        }
      }, [ready, getRealSnapshot]);
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    };

    return {
      ready,
      useClientStore,
    };
  };

  return {
    createStore,
    StoreProvider: getStoreProvider(context),
    useStore,
    useCreateClientStore,
  };
}

