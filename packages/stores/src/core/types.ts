import type { ReactNode } from "react";

import { STORE_INSTANCE_INTERNALS, STORE_DEFINITION_INTERNALS } from "./constants";

export type DefinitionID = symbol & { _definitionId: true };
export type ProviderID   = symbol & { _providerId: true };
export type InstanceID   = symbol & { _instanceId: true };

// ---------------------------------------------------------------------------
// Public store API
// ---------------------------------------------------------------------------

export type MessageHandler<Message> = (message: Message) => void;

export interface IsoStoreInstance<NativeStore> {
  whenReady: Promise<void>;
  nativeStore: NativeStore;
}

export type StoreProvider<NativeStore> = React.FC<{
  instance: IsoStoreInstance<NativeStore>;
  children: ReactNode;
}>;

export type SendMessage<Message> = (message: Message) => void;

export type UseCreateClientStore<Opts, NativeClientHooks> = (opts: Opts) => readonly [ready: boolean, clientHooks: NativeClientHooks];

export interface IsoStoreDefinition<Opts, Message, NativeStore, NativeHooks extends AllFunctions<NativeHooks>, NativeClientHooks extends AllFunctions<NativeClientHooks>> {
  createStore: (opts: Opts) => IsoStoreInstance<NativeStore>;
  hooks: NativeHooks;
  useCreateClientStore: UseCreateClientStore<Opts, NativeClientHooks>;
  broadcast: SendMessage<Message>;
}

// ---------------------------------------------------------------------------
// Internal types (not exported from package index)
// ---------------------------------------------------------------------------

export interface InternalIsoStoreInstance<NativeStore> extends IsoStoreInstance<NativeStore> {
  [STORE_INSTANCE_INTERNALS]: {
    identifier: InstanceID;
    definition: InternalIsoStoreDefinition<any, any, any, any, any>;
    messageHandlers: Array<MessageHandler<any>>;
    onMount: () => void;
  };
}

export interface InternalIsoStoreDefinition<Opts, Message, NativeStore, NativeHooks extends AllFunctions<NativeHooks>, NativeClientHooks extends AllFunctions<NativeClientHooks>> extends IsoStoreDefinition<Opts, Message, NativeStore, NativeHooks, NativeClientHooks> {
  createStore: (opts: Opts) => InternalIsoStoreInstance<NativeStore>;
  [STORE_DEFINITION_INTERNALS]: {
    instancesByProvider: Map<ProviderID, InternalIsoStoreInstance<NativeStore>>;
    StoreProvider: StoreProvider<NativeStore>;
    adapter: Adapter<any, NativeStore, any, any, any>;
  };
}

export type WaitFor = (p: Promise<unknown>) => void;

export type SetAsync<State> = <K extends keyof State, V extends State[K]>(
  name: K,
  promise: Promise<V>,
) => { [_ in K]: V };

export type SetNonBlockingAsync<State> = <K extends keyof State, V extends State[K]>(
  name: K,
  promise: Promise<V>,
  initialValue: V,
) => { [_ in K]: V };

export type OnMessage<Message> = (handler: MessageHandler<Message>) => void;

// Functions passed to the outer factory when defining a store.
export interface IsoInitFns<State, Message> {
  waitFor: WaitFor;
  setAsync: SetAsync<State>;
  setNonBlockingAsync: SetNonBlockingAsync<State>;
  onMessage: OnMessage<Message>;
}

// The outer layer of the two-layer factory pattern: receives opts and fns,
// returns the framework's native inner creator (e.g. Zustand's StateCreator).
export type IsoStoreInit<Opts, State, Message, NativeStoreInit> =
  (opts: Opts, fns: IsoInitFns<State, Message>) => NativeStoreInit;

export type AllFunctions<T> = { [K in keyof T]: (...args: any[]) => any };

export interface Adapter<State, NativeStore, NativeStoreInit, NativeHooks extends AllFunctions<NativeHooks>, NativeClientHooks extends AllFunctions<NativeClientHooks>> {
  createNativeStore: (nativeStoreInit: NativeStoreInit) => NativeStore;
  getSetState: (nativeStore: NativeStore) => (state: Partial<State>) => void;
  useHooks: (useNativeStore: () => NativeStore) => NativeHooks;
  useClientHooks: (useNativeStore: () => NativeStore, ready: boolean) => NativeClientHooks;
  empty: NativeStore;
}
