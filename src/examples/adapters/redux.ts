import {
  createStore as createReduxStore,
  type Store as ReduxStore,
  type Reducer,
  type Dispatch,
  type AnyAction,
} from "redux";
import { useSyncExternalStore } from "react";
import {
  defineIsoStore,
  type StoreInit,
  type NativeStoreFactory,
} from "../../adapter";

const ISO_SET_STATE = '@@isostores/SET_STATE';

const emptyReduxStore = createReduxStore((state = {}) => state);

type ReduxStoreInit<State> = (dispatch: Dispatch, getState: () => State) => Reducer<State>;

export const defineReduxIsoStore = <Opts, State, Message = never>(
  init: StoreInit<Opts, State, Message, ReduxStoreInit<State>>
) => {
  const factory: NativeStoreFactory<Opts, State, Message, ReduxStore<State>> = (opts, waitFor, onMessage) => {
    const makeReducer = init(opts, waitFor, onMessage);
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
  };

  const getHook = (getStore: () => ReduxStore<State>) =>
    <U>(selector: (s: State) => U): U =>
      useSyncExternalStore(
        (callback) => getStore().subscribe(callback),
        () => selector(getStore().getState()),
      );

  return defineIsoStore(factory, {
    getSetState: (store: ReduxStore<State>) => (
      (partial: Partial<State>) => (
        store.dispatch({ type: ISO_SET_STATE, payload: partial })
      )
    ),
    getHook,
    getClientHook: (getNativeStore: () => ReduxStore<State>, ready: boolean) => (
      <U>(selector: (s: State) => U): U | undefined => {
        const hook = getHook(getNativeStore);
        const value = hook(selector);
        return ready ? value : undefined;
      }
    ),
    getEmpty: () => emptyReduxStore as unknown as ReduxStore<State>,
  });
};
