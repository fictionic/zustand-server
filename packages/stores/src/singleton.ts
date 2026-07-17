import {getRLS} from "@verso-js/verso";
import {useEffect, useState} from "react";
import type {IsoStoreDefinition, IsoStoreInstance} from "./core/types";
import {STORE_DEFINITION_INTERNALS} from "./core/constants";

const RLS = getRLS<{ instances: Map<IsoStoreDefinition<any, never, any, any, any>, IsoStoreInstance<any>> }>();

function getInstances(): Map<IsoStoreDefinition<any, never, any, any, any>, IsoStoreInstance<any>> {
  const ns = RLS();
  if (!ns.instances) ns.instances = new Map();
  return ns.instances;
}

export type UseClientHooks<NativeClientHooks> = () => readonly [ready: boolean, clientHooks: NativeClientHooks];

type NativeClientHooksOf<D> = D extends IsoStoreDefinition<any, never, any, any, infer C> ? C : never;

export type AsSingletonDefinition<D extends IsoStoreDefinition<any, never, any, any, any>> = {
  createStore: D['createStore'];
  hooks: D['hooks'];
  useClientHooks: UseClientHooks<NativeClientHooksOf<D>>;
  message: D['broadcast'];
};

// broadcast uses `never` so that SendMessage<never> (no-message stores) is assignable:
// (msg: Message) => void extends (msg: never) => void since never extends Message for all Message.
export function asSingleton<D extends IsoStoreDefinition<any, never, any, any, any>>(def: D): AsSingletonDefinition<D> {
  return {
    createStore: ((opts: Parameters<D['createStore']>[0]) => {
      const instances = getInstances();
      if (instances.has(def)) {
        throw new Error("cannot create more than one instance of a singleton store!");
      }
      const instance = def.createStore(opts);
      instances.set(def, instance);
      return instance;
    }) as D['createStore'],
    /**
     * accesses the singleton through context, like normal. will throw if instance not provided.
     */
    hooks: def.hooks,
    /**
     * allows cross-root access to the singleton. has to be resilient against the store
     * not being ready at call time, since an arbitrary root won't be blocked by its resolution.
     * this is clientside only, because if you need server-side access to the store, your root
     * needs to be gated on its resolution, so you might as well just Provide it, and then you
     * should just be using the regular .hooks bag.
     */
    useClientHooks: () => {
      const [ready, setReady] = useState(false);
      const instance = getInstances().get(def) ?? null;
      if (!instance) {
        throw new Error("no singleton instance has been created");
      }
      useEffect(() => {
        void instance.whenReady.then(() => {
          setReady(true);
        });
      }, []);
      const adapter = (def as any)[STORE_DEFINITION_INTERNALS].adapter;
      const useNativeStore = () => ready ? instance.nativeStore : adapter.empty;
      const clientHooks = adapter.useClientHooks(useNativeStore, ready);
      return [ready, clientHooks];
    },
    message: def.broadcast,
  };
}
