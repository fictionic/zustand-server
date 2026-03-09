import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {Adapter, StoreFactory} from "./adapter";
import {getStoreProvider} from "./StoreProvider";
import {
  STORE_INTERNALS,
  type AdaptedStore,
  type Broadcast,
  type IsoStoreInstance,
  type MessageHandler,
  type OnMessage,
  type UseClientStore,
  type UseCreateClientStore,
  type UseStore,
  type WaitFor
} from "./types";

function makeWaitFor<State>(pending: Array<{name: keyof State, promise: Promise<unknown>}>): WaitFor<State> {
  // defined via function because otherwise I'd have to write the types on the next line twice
  return <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => {
    pending.push({ name, promise });
    return { [name]: initialValue } as { [key in K]: V };
  };
}

export const defineIsoStore = <Opts, State, Message = never, NativeStore = never>(
  factory: StoreFactory<Opts, State, Message, NativeStore>,
  adapter: Adapter<NativeStore>,
) => {
  const instances: Map<symbol, IsoStoreInstance<State, Message>> = new Map();
  const createStore = (opts: Opts) => {
    type PendingValue = { name: keyof State, promise: Promise<unknown> };
    const pending: Array<PendingValue> = [];
    const waitFor = makeWaitFor<State>(pending);
    const messageHandlers: Array<MessageHandler<Message>> = [];
    const onMessage: OnMessage<Message> = (handler) => {
      messageHandlers.push(handler);
    };
    const nativeStore = factory(opts, waitFor, onMessage);
    const adaptedStore = adapter<State>(nativeStore);
    const whenReady = Promise.all(pending.map(async ({ name, promise }) => {
      const value = await promise;
      adaptedStore.setState({ [name]: value } as Partial<State>);
    })).then(() => {});
    return {
      adaptedStore,
      whenReady,
      [STORE_INTERNALS]: {
        identifier: Symbol(),
        messageHandlers,
      },
    };
  };

  const context = createContext<AdaptedStore<State> | null>(null);

  const useStore: UseStore<State> = (selector) => {
    const adaptedStore = useContext(context)
    const { subscribe, getState } = adaptedStore!;
    const getSnapshot = useCallback(() => selector(getState()), [selector]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };

  const register = (instance: IsoStoreInstance<State, Message>) => {
    instances.set(instance[STORE_INTERNALS].identifier, instance);
  };

  const teardown = (instance: IsoStoreInstance<State, Message>) => {
    instances.delete(instance[STORE_INTERNALS].identifier);
  };

  const useCreateClientStore: UseCreateClientStore<Opts, State> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    const instanceRef = useRef<IsoStoreInstance<State, Message> | null>(null);

    useEffect(() => {
      const instance = createStore(opts);
      register(instance);
      instance.whenReady.then(() => {
        setReady(true);
      });
      instanceRef.current = instance;
      return () => {
        teardown(instance);
        instanceRef.current = null;
      };
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

  const broadcast: Broadcast<Message> = (message: Message) => {
    instances.entries().forEach(([_, instance]) => {
      instance[STORE_INTERNALS].messageHandlers.forEach((handler) => {
        handler(message);
      });
    });
  };

  return {
    createStore,
    StoreProvider: getStoreProvider(context, register, teardown),
    useStore,
    useCreateClientStore,
    broadcast,
  };
}


