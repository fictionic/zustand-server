import {
  createStore as createReduxStore,
  type Store as ReduxStore,
  type Reducer,
  type Dispatch,
  type AnyAction,
} from "redux";
import { useSyncExternalStore } from "react";
import { type Adapter } from '@verso-js/stores/adapter';

const ISO_SET_STATE = '@@isostores/SET_STATE';

const emptyReduxStore = createReduxStore((state = {}) => state);

export type ReduxStoreInit<State> = (dispatch: Dispatch, getState: () => State) => Reducer<State>;

interface ReduxHooks<State> {
  useSelector: <U>(selector: (s: State) => U) => U;
  useDispatch: () => Dispatch;
};

interface ReduxClientHooks<State> {
  useSelector: <U>(selector: (s: State) => U) => U | undefined;
  useDispatch: () => Dispatch;
};

export const getAdapter = <State extends object>(): Adapter<State, ReduxStore<State>, ReduxStoreInit<State>, ReduxHooks<State>, ReduxClientHooks<State>> => {
  const useHooks = (useNativeStore: () => ReduxStore<State>) => {
    return {
      useSelector: <U>(selector: (s: State) => U): U => {
        const store = useNativeStore();
        return useSyncExternalStore(
          (callback: () => void) => store.subscribe(callback),
          () => selector(store.getState()),
        );
      },
      useDispatch: () => useNativeStore().dispatch,
    };
  };

  return {
    createNativeStore: (makeReducer) => {
      let storeRef: ReduxStore<State>;
      const realReducer = makeReducer(
        (action) => storeRef.dispatch(action),
        () => storeRef.getState(),
      );
      const wrappedReducer: Reducer<State, AnyAction> = (state, action) => {
        if (action.type === ISO_SET_STATE) return { ...state, ...action.payload };
        return realReducer(state, action);
      };
      storeRef = createReduxStore<State, AnyAction>(wrappedReducer);
      return storeRef;
    },
    getSetState: (store) => (partial) => store.dispatch({ type: ISO_SET_STATE, payload: partial }),
    useHooks,
    useClientHooks: (useNativeStore, ready) => {
      const hooks = useHooks(useNativeStore);
      return {
        useSelector: <U>(selector: (s: State) => U): U | undefined => {
          const value = hooks.useSelector(selector);
          return ready ? value : undefined;
        },
        useDispatch: () => {
          const dispatch = hooks.useDispatch();
          return ready ? dispatch : () => { throw new Error("cannot dispatch before ready"); };
        },
      };
    },
    empty: emptyReduxStore as ReduxStore<State>,
  };
};
