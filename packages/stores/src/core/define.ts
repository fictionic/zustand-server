import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {getStoreProvider} from "./getStoreProvider";
import {
  STORE_DEFINITION_INTERNALS,
  STORE_INSTANCE_INTERNALS,
} from "./constants";
import {
  type Adapter,
  type SendMessage,
  type DefinitionID,
  type InstanceID,
  type IsoStoreDefinition,
  type IsoStoreInit,
  type InternalIsoStoreInstance,
  type MessageHandler,
  type OnMessage,
  type ProviderID,
  type UseCreateClientStore,
  type WaitFor,
  type SetAsync,
  type SetNonBlockingAsync,
} from "./types";
import {useIsoStoreLifecycle} from "./lifecycle";

type NativeStoreOf<A> = A extends Adapter<any, infer N, any, any, any> ? N : never;
type HooksOf<A> = A extends Adapter<any, any, any, infer H, any> ? H : never;
type ClientHooksOf<A> = A extends Adapter<any, any, any, any, infer C> ? C : never;

type PendingValue<T> = {
  promise: Promise<T>;
  consumer: (t: T) => void;
};

// currently, stores should not be defined dynamically, as this will lead to memory leaks
// we're typing the values as any because of the shenanigans with CreateStoreArgs
const definitions: Map<DefinitionID, any> = new Map();

export function defineIsoStore<Opts, State extends object, Message, NativeStoreInit, A extends Adapter<State, any, NativeStoreInit, any, any>>(
  isoInit: IsoStoreInit<Opts, State, Message, NativeStoreInit>,
  adapter: A,
  options?: {
    onError?: (error: unknown) => void;
  },
): IsoStoreDefinition<Opts, Message, NativeStoreOf<A>, HooksOf<A>, ClientHooksOf<A>> {
  type NativeStore = NativeStoreOf<A>;
  const definitionId = Symbol() as DefinitionID;

  const instancesByProvider: Map<ProviderID, InternalIsoStoreInstance<NativeStore>> = new Map();

  const createStore = (opts: Opts): InternalIsoStoreInstance<NativeStore> => {
    const asyncKeys = new Set<keyof State>();
    const blocking: Set<PendingValue<any>> = new Set();
    const nonBlocking: Set<PendingValue<any>> = new Set();

    const trackPendingValue = <T>(pending: Set<PendingValue<any>>, promise: Promise<T>, consumer: (t: T) => void) => {
      pending.add({ promise, consumer });
    };

    // block on a promise and ignore the fulfilled value
    const waitFor: WaitFor = (p) => trackPendingValue(blocking, p, () => {});

    function makeAsyncSetter(pendingValues: Set<PendingValue<any>>, setState: (update: Partial<State>) => void) {
      return <K extends keyof State, V extends State[K]>(key: K, promise: Promise<V>, initialValue?: V) => {
        if (asyncKeys.has(key)) {
          throw new Error(`duplicate async key '${String(key)}'`);
        }
        asyncKeys.add(key);
        trackPendingValue(
          pendingValues,
          promise,
          (value) => {
            const update = { [key]: value } as Partial<State>;
            setState(update);
          },
        );
        return { [key]: initialValue } as { [_ in K]: V };
      };
    }

    let nativeStore!: NativeStore;
    const setState = (update: Partial<State>) => {
      const setState = adapter.getSetState(nativeStore);
      setState(update);
    };

    // block on a promise and set the fulfilled value on the state at the given key
    const setAsync: SetAsync<State> = makeAsyncSetter(blocking, setState);

    // set the fulfilled value of a promise on the state at the given key without blocking
    const setNonBlockingAsync: SetNonBlockingAsync<State> = makeAsyncSetter(nonBlocking, setState);

    const didMountDfd = Promise.withResolvers<void>();

    const messageHandlers: Array<MessageHandler<Message>> = [];
    const onMessage: OnMessage<Message> = (handler) => {
      messageHandlers.push(handler);
    };

    const nativeStoreInit = isoInit(opts, { waitFor, setAsync, setNonBlockingAsync, onMessage });
    nativeStore = adapter.createNativeStore(nativeStoreInit);

    async function handlePending(pendingValues: Set<PendingValue<unknown>>) {
      await Promise.all(pendingValues.values().map((entry) => {
        return entry.promise.then(
          entry.consumer,
          (err) => {
            options?.onError?.(new Error('pending promise rejected', { cause: err }));
          },
        );
      }));
    }

    const whenReady = handlePending(blocking);

    didMountDfd.promise.then(() => handlePending(nonBlocking));

    return {
      whenReady,
      nativeStore,
      [STORE_INSTANCE_INTERNALS]: {
        identifier: Symbol() as InstanceID,
        definition: definitions.get(definitionId)!,
        messageHandlers,
        onMount: () => {
          // TODO: move all the lifecycle logic into onMount. make it idempotent.
          // stores might not have to hold a reference to their definition anymore.
          // the lifecycle hook can just be a call to onmount.
          didMountDfd.resolve();
        },
      },
    };
  };

  type IsoContext = InternalIsoStoreInstance<NativeStore> | null;
  const context = createContext<IsoContext>(null);

  const hooks: HooksOf<A> = adapter.useHooks(() => {
    const instance = useContext<IsoContext>(context);
    if (!instance) {
      throw new Error("isomorphic-stores: cannot call hooks outside a provider");
    }
    return instance.nativeStore;
  });

  const useCreateClientStore: UseCreateClientStore<Opts, ClientHooksOf<A>> = (opts) => {
    const [ready, setReady] = useState<boolean>(false);
    const instanceRef = useRef<InternalIsoStoreInstance<NativeStore> | null>(null);

    const providerId = useMemo(() => Symbol() as ProviderID, []);

    useEffect(() => {
      const instance = createStore(opts); // ideally we'd support rerendering based on changes to opts
      instance.whenReady.then(() => {
        setReady(true);
      });
      instanceRef.current = instance;
      return () => {
        instanceRef.current = null;
      };
    }, [providerId]);

    useIsoStoreLifecycle(providerId, instanceRef.current);

    const useNativeStore = () => instanceRef.current?.nativeStore ?? adapter.empty;
    const clientHooks = adapter.useClientHooks(useNativeStore, ready);

    return [ready, clientHooks];

  };

  const broadcast: SendMessage<Message> = (message: Message) => {
    const seen = new Set<InstanceID>();
    for (const instance of instancesByProvider.values()) {
      const instanceId = instance[STORE_INSTANCE_INTERNALS].identifier;
      if (seen.has(instanceId)) return;
      seen.add(instanceId);
      instance[STORE_INSTANCE_INTERNALS].messageHandlers.forEach(h => h(message));
    }
  };

  const definition = {
    createStore,
    hooks,
    useCreateClientStore,
    broadcast,
    [STORE_DEFINITION_INTERNALS]: {
      instancesByProvider,
      StoreProvider: getStoreProvider(context),
      adapter,
    },
  };

  definitions.set(definitionId, definition);

  return definition;

}
