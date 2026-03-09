import { type ReactNode } from "react";
import type {IsoStoreInstance, StoreProvider} from "../../core";
import RootElement from "./RootElement";

// react-server projects could use something like this to wrap RootElement for use with isostores
interface Props<State, Message> {
  instance: IsoStoreInstance<State, Message>
  StoreProvider: StoreProvider<State, Message>;
  children: ReactNode;
}
export function StoreRoot<State, Message>({
  instance,
  StoreProvider,
  children,
}: Props<State, Message>) {
  return (
    <RootElement when={instance.whenReady}>
      <StoreProvider instance={instance}>
        { children }
      </StoreProvider>
    </RootElement>
  );
}
