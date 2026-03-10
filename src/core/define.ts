import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {Adapter, NativeStoreFactory} from "./adapter";
import {getStoreProvider} from "./StoreProvider";
import {
  STORE_DEFINITION_INTERNALS,
  STORE_INSTANCE_INTERNALS,
  type Broadcast,
  type IsoStoreDefinition,
  type IsoStoreInstance,
  type MessageHandler,
  type OnMessage,
  type UseCreateClientStore,
  type WaitFor
} from "./types";

function makeWaitFor<State>(pending: Array<{name: keyof State, promise: Promise<unknown>}>): WaitFor<State> {
  // defined via function because otherwise I'd have to write the types on the next line twice
  return <K extends keyof State, V extends State[K]>(name: K, promise: Promise<V>, initialValue: V) => {
    pending.push({ name, promise });
    return { [name]: initialValue } as { [key in K]: V };
  };
}

const definitions: Map<symbol, IsoStoreDefinition<any, any, any, any, any>> = new Map();

type BaseNativeHook = <S>(...args: any) => S;
type BaseNativeClientHook = <S>(...args: any) => S | undefined;

export const defineIsoStore = <Opts, State, Message, NativeStore, NativeHook extends BaseNativeHook, NativeClientHook extends BaseNativeClientHook>(
  factory: NativeStoreFactory<Opts, State, Message, NativeStore>,
  adapter: Adapter<State, NativeStore, NativeHook, NativeClientHook>,
): IsoStoreDefinition<Opts, Message, NativeStore, NativeHook, NativeClientHook> => {
  const definitionId = Symbol();

  const instances: Map<symbol, IsoStoreInstance<NativeStore>> = new Map();

  const createStore = (opts: Opts): IsoStoreInstance<NativeStore> => {
    type PendingValue = { name: keyof State, promise: Promise<unknown> };
    const pending: Array<PendingValue> = [];
    const waitFor = makeWaitFor<State>(pending);
    const messageHandlers: Array<MessageHandler<Message>> = [];
    const onMessage: OnMessage<Message> = (handler) => {
      messageHandlers.push(handler);
    };
    const nativeStore = factory(opts, waitFor, onMessage);
    const whenReady = Promise.all(pending.map(async ({ name, promise }) => {
      const value = await promise;
      const setState = adapter.getSetState(nativeStore);
      setState({ [name]: value } as Partial<State>);
    })).then(() => {});
    return {
      whenReady,
      [STORE_INSTANCE_INTERNALS]: {
        identifier: Symbol(),
        definition: definitions.get(definitionId)!,
        nativeStore,
        messageHandlers,
      },
    };
  };

  type IsoContext = IsoStoreInstance<NativeStore> | null;
  const context = createContext<IsoContext>(null);

  const register = (instance: IsoStoreInstance<NativeStore>) => {
    instances.set(instance[STORE_INSTANCE_INTERNALS].identifier, instance);
  };

  const teardown = (instance: IsoStoreInstance<NativeStore>) => {
    instances.delete(instance[STORE_INSTANCE_INTERNALS].identifier);
  };

  const useStore: NativeHook = adapter.getHook(() => useContext<IsoContext>(context)![STORE_INSTANCE_INTERNALS].nativeStore);

  const useCreateClientStore: UseCreateClientStore<Opts, NativeClientHook> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    const readyRef = useRef<boolean>(ready);
    const instanceRef = useRef<IsoStoreInstance<NativeStore> | null>(null);

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

    const useClientStore = useCallback((...args: any) => {
      const getNativeStore = () => (
        readyRef.current ? instanceRef.current![STORE_INSTANCE_INTERNALS].nativeStore : adapter.getEmpty()
      );
      const hook = adapter.getClientHook(getNativeStore, readyRef.current);
      return hook(...args);
    }, []) as NativeClientHook;

    return {
      ready,
      useClientStore,
    };
  };

  const broadcast: Broadcast<Message> = (message: Message) => {
    instances.entries().forEach(([_, instance]) => {
      instance[STORE_INSTANCE_INTERNALS].messageHandlers.forEach((handler) => {
        handler(message);
      });
    });
  };

  const definition = {
    createStore,
    useStore,
    useCreateClientStore,
    broadcast,
    [STORE_DEFINITION_INTERNALS]: {
      StoreProvider: getStoreProvider(context, register, teardown),
    },
  };

  definitions.set(definitionId, definition);

  return definition;
}


