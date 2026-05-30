import type { AsyncLocalStorage } from 'node:async_hooks'; // type imports erased at runtime

type ModuleNamespaces = Map<symbol, any>;

let als: AsyncLocalStorage<ModuleNamespaces> | null = null;
if (globalThis.IS_SERVER) {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  als = new AsyncLocalStorage<ModuleNamespaces>();
}

export function runWithServerRLS<R>(fn: () => R): R {
  if (!als) throw new Error('startRequest requires a server environment');
  return als.run(new Map(), fn);
}

let clientStore: ModuleNamespaces | null = null;

export function startClientRLS(): void {
  clientStore = new Map();
}

export function stopClientRLS(): void {
  clientStore = null;
}

export function getRLS<T extends Record<string | symbol, any>>(): () => T {
  const moduleKey = Symbol();
  const RLS = () => {
    let store: ModuleNamespaces | null = null;
    if (globalThis.IS_SERVER) {
      store = als!.getStore() ?? null;
    } else {
      store = clientStore;
    }
    if (!store) {
      throw new Error("RLS() access outside of request!");
    }
    if (!store.has(moduleKey)) store.set(moduleKey, {});
    return store.get(moduleKey) as T;
  };
  const throwIncorrectRLS = (prop: string) => {
    throw new Error(`Use of RLS.${prop} should be RLS().${prop}!`);
  };
  return new Proxy(RLS, {
    get(_, prop) {
      throwIncorrectRLS(String(prop));
    },
    set(_, prop) {
      throwIncorrectRLS(String(prop));
      return false;
    },
  });
};
