import {
  createStore as createReduxStore,
  type Store as ReduxStore,
  type Reducer,
  type Dispatch,
  type AnyAction,
} from "redux";
import type {Adapter, StoreInit, StoreFactory} from "../../core/adapter";
import {defineIsoStore} from "../../core/define";
import {type IsoStoreDefinition} from "../../core/types";

const ISO_SET_STATE = '@@isostores/SET_STATE';

const adapter: Adapter<ReduxStore<any>> = <State>(store: ReduxStore<State>) => ({
  getState: store.getState,
  setState: (partial: Partial<State>) => store.dispatch({ type: ISO_SET_STATE, payload: partial }),
  subscribe: (listener) => {
    const unsubscribe = store.subscribe(listener);
    return unsubscribe;
  },
});

type ReduxStoreInit<State> = (dispatch: Dispatch, getState: () => State) => Reducer<State>;

export const defineReduxIsoStore = <Opts, State, Message = never>(
  init: StoreInit<Opts, State, Message, ReduxStoreInit<State>>
): IsoStoreDefinition<Opts, State, Message> => {
  const factory: StoreFactory<Opts, State, Message, ReduxStore<State>> = (opts, waitFor, onMessage) => {
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
  return defineIsoStore(factory, adapter);
};
