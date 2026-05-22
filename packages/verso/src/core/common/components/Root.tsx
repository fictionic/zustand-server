import React, {createContext, StrictMode, useContext, type ReactElement, type ReactNode} from 'react';
import {PAGE_ELEMENT_TOKEN_IDX_ATTR, PAGE_ROOT_ELEMENT_ATTR} from '../constants';

const ROOT_COMPONENT = Symbol('verso.RootComponent');

type WhenResult = unknown;

export interface RootAPI {
  when?: Promise<WhenResult>;
};

interface RootProps extends RootAPI {
  children: React.ReactNode;
}

type DeriveRootAPI<P> = (props: P) => RootAPI;

export interface RootComponent<P> extends React.FC<P> {
  [ROOT_COMPONENT]: {
    deriveRootAPI: DeriveRootAPI<P>;
  };
}

export type RootElementType<P = object> = React.ReactElement<P> & { type: RootComponent<P> };

export function makeRootComponent<P>(
  Component: React.FC<P>,
  deriveRootAPI: DeriveRootAPI<P>,
): RootComponent<P> {
  return Object.assign(
    Component,
    {[ROOT_COMPONENT]: { deriveRootAPI }},
  );
}

function isRootElement(element: ReactElement): element is RootElementType {
  return React.isValidElement(element) && typeof element.type === 'function' && ROOT_COMPONENT in element.type;
}

export function ensureRootElement(element: ReactElement): RootElementType {
  return isRootElement(element) ? element : <Root>{element}</Root> as RootElementType;
}

const RootPassthrough: React.FC<{ children: ReactNode }> = ({ children }) => children;
RootPassthrough.displayName = 'Root';

export const Root = makeRootComponent<RootProps>(RootPassthrough, (p) => p);

const NO_ROOT = Symbol('verso.NoRoot');
const RootContext = createContext<WhenResult>(NO_ROOT);

export async function scheduleRootRender(element: RootElementType): Promise<ReactElement> {
  const { deriveRootAPI } = element.type[ROOT_COMPONENT];
  const { when } = deriveRootAPI(element.props);
  const promise = when ?? Promise.resolve();
  const data = await promise
    .catch((err) => {
      console.error("[verso] rejection from Root 'when' promise; using null data", err);
      return null;
    });
  return (
    <StrictMode>
      <RootContext.Provider value={data}>
        {element}
      </RootContext.Provider>
    </StrictMode>
  );
}

export function useRootData<T>(): T {
  const value = useContext(RootContext);
  if (value === NO_ROOT) {
    throw new Error('[verso] useRootData() called outside a Root!');
  }
  return value as T;
}

export function renderRootToString(index: number, innerHtml: string) {
  return `<div ${PAGE_ELEMENT_TOKEN_IDX_ATTR}="${index}" ${PAGE_ROOT_ELEMENT_ATTR}>${innerHtml}</div>\n`;
}

// for client transitions
export function setRootAttrs(element: HTMLElement, index: number) {
  element.setAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR, String(index));
  element.setAttribute(PAGE_ROOT_ELEMENT_ATTR, '');
}
