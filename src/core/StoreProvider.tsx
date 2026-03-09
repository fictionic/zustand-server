import {useEffect, type Context, type ReactNode} from "react";
import {type IsoStoreInstance, type StoreProvider, type AdaptedStore} from "./types";

export function getStoreProvider<State, Message>(
  context: Context<AdaptedStore<State> | null>,
  register: ((instance: IsoStoreInstance<State, Message>) => void),
  teardown: ((instance: IsoStoreInstance<State, Message>) => void)
): StoreProvider<State, Message> {

  const {Provider} = context;

  interface Props {
    instance: IsoStoreInstance<State, Message>;
    children: ReactNode;
  }
  return function StoreProvider({
    instance,
    children,
  }: Props) {
    useEffect(() => {
      register(instance);
      return () => {
        teardown(instance);
      };
    }, [instance]); // not sure why instance would ever change, but maybe
    return (
      <Provider value={instance.adaptedStore}>
        {children}
      </Provider>
    );
  }
}
