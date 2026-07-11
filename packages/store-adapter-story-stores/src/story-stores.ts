import {batch as _batch, createStoryStore, type Selector, type StoryInit, type StoryStore} from "story-stores/vanilla";
import {useStoryStore, type UseStory} from "story-stores/react";
import {defineIsoStore, type Adapter, type IsoStoreInit} from "@verso-js/stores/adapter";
import type {IsoStoreInstance} from "@verso-js/stores";
import {isServer} from "@verso-js/verso";

type Consumer<T> = (value: T) => void;

// Adapter's listen takes IsoStoreInstances, not vanilla Stores
type IsoListen = <S, T>(instance: IsoStoreInstance<StoryStore<S>>, selector: Selector<S, T>, consumer: Consumer<T>) => void;

type Select<State> = <T>(selector: Selector<State, T>) => T;
type Update<State> = (updater: (state: State) => void) => void;

// The consumer-facing init receives listen that works with IsoStoreInstances
export type IsoInit<State> = (fns: { select: Select<State>, update: Update<State>, listen: IsoListen }) => State;

type StoryHooks<State> = {
  useStory: UseStory<State>;
}

type UseClientStory<State> = <T>(selector: Selector<State, T>) => T | undefined;

type StoryClientHooks<State> = {
  useStory: UseClientStory<State>;
}

export const getAdapter: <State extends object>() => Adapter<
  State,
  StoryStore<State>,
  StoryInit<State>,
  StoryHooks<State>,
  StoryClientHooks<State>
> = <State>() => {
  return {
    createNativeStore: (init) => {
      const store = createStoryStore(init);
      store.selectInitial = store.select; // same deal as zustand
      return store;
    },
    getSetState: (store) => {
      return (partial) => (
        store.update((state) => {
          Object.assign(state, partial);
        })
      );
    },
    useHooks: (useNativeStore) => {
      return {
        useStory: (selector) => {
          const store = useNativeStore();
          return useStoryStore(store, selector);
        },
      };
    },
    useClientHooks: (useNativeStore, ready) => {
      return {
        useStory: (selector) => {
          const store = useNativeStore();
          const result = useStoryStore(store, selector);
          return ready ? result : undefined;
        },
      };
    },
    empty: createStoryStore(() => ({})) as StoryStore<State>,
  };
};

type StoreFns<State> = { select: Select<State>, update: Update<State>, listen: IsoListen };

type IsoStoryInit<State> = (fns: StoreFns<State>) => State;

export const defineStoryStore = <Opts, State extends object, Message = never>(
  _isoInit: IsoStoreInit<Opts, State, Message, IsoStoryInit<State>>,
  options?: { onError?: (error: unknown) => void },
) => {
  const isoInit: IsoStoreInit<Opts, State, Message, StoryInit<State>> =
    (opts, isoFns) =>
      ({ select, update, listen }) => {
        const isoListen: IsoListen = (parentInstance, selector, consumer) => {
          isoFns.waitFor(parentInstance.whenReady);
          listen(parentInstance.nativeStore, selector, consumer);
          // ^discarding the unsubscriber. who would call it?
        };
        const storyInit = _isoInit(opts, isoFns);
        return storyInit({ select, update, listen: isoListen });
      };

  return defineIsoStore(isoInit, getAdapter<State>(), options);
};

export function batch(action: () => void) {
  if (isServer()) {
    throw new Error('cannot call batch() on the server');
  }
  return _batch(action);
}
