import {createContext, useContext, useEffect, useMemo, useRef, useState, type Provider} from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore as useZustandStore } from "zustand";

export type ZustandStore<State> = StoreApi<State>;

interface StoreConfig<State> {
  state: State;
  promises?: { [K in keyof State]?: Promise<State[K]> }
};

export type StoreInit<Opts, State> = (
  opts: Opts,
  set: ZustandStore<State>['setState'],
  get: ZustandStore<State>['getState'],
) => StoreConfig<State>;

export interface StoreInstance<State> {
  zStore: ZustandStore<State>;
  ready: Promise<void>;
}

export type UseStore<State> = <T>(selector: (state: State) => T) => T;
type UseClientStore<Opts, State> = <T>(selector: (state: State) => T) => {
  ready: boolean;
  selection: T | null;
};

export interface StoreDefinition<Opts, State> {
  create: (opts: Opts) => StoreInstance<State>
  Provider: Provider<ZustandStore<State> | null>;
  useStore: UseStore<State>;
  useClientStore: UseClientStore<Opts, State>;
}

export function defineStore<Opts, State>(init: StoreInit<Opts, State>): StoreDefinition<Opts, State> {
  const create = (opts: Opts) => {
    let promises: StoreConfig<State>['promises'] | null = null;
    const zStore = createStore<State>((set, get) => {
      const def = init(opts, set, get);
      if (def.promises) {
        promises = def.promises;
      }
      return def.state;
    });
    const ready = Promise.all(Object.entries(promises ?? {}).map(([k, p]) => {
      type Promises = StoreConfig<State>['promises'];
      const key = k as keyof Promises;
      const promise = p as Promises[typeof key];
      return promise!.then((value: State[typeof key]) => {
        zStore.setState({ [key]: value } as Partial<State>);
      });
    })).then(() => {});
    const instance = {
      zStore,
      ready,
    };
    return instance;
  };
  const context = createContext<ZustandStore<State> | null>(null);
  const useStore: UseStore<State> = (selector) => {
    const zStore = useContext(context)
    return useZustandStore(zStore!, selector);
  };
  const useClientStore: UseClientStore<Opts, State> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    useEffect(() => {
      const instance = create(opts);
      instance.ready.then(() => {
        setReady(true);
      });
    }, []);
    const selection = useZustandStore(instance.zStore, selector);
    return {
      ready,
      selection,
    };
  };
  return {
    create,
    Provider: context.Provider,
    useStore,
    createClientStore,
  };
}

