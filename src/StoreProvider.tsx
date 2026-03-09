import type {Context, ReactNode} from "react";
import type {StoreInstance, StoreProvider, AdaptedStore} from "./core";

export function getStoreProvider<State>(context: Context<AdaptedStore<State> | null>): StoreProvider<State> {

  const {Provider} = context;

  interface Props {
    instance: StoreInstance<State>;
    children: ReactNode;
  }
  return function StoreProvider({
    instance,
    children,
  }: Props) {
    return (
      <Provider value={instance.adaptedStore}>
        {children}
      </Provider>
    );
  }
}
