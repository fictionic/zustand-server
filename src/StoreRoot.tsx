import {  type ReactNode } from "react";
import type {StoreDefinition, StoreInstance} from "./zustand-server";
import RootElement from "./RootElement";

interface Props<State> {
  instance: StoreInstance<State>
  def: StoreDefinition<any, State>;
  children: ReactNode;
}
export function StoreRoot<State>({
  instance,
  def,
  children,
}: Props<State>) {
  return (
    <RootElement when={() => instance.ready}>
      <def.Provider value={instance.zStore}>
        { children }
      </def.Provider>
    </RootElement>
  );
}
