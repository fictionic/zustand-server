import {createContext, isValidElement, StrictMode, useContext, type FC, type ReactElement, type ReactNode} from 'react';
import {type RenderableHTMLAttributes} from './attrs';

const ROOT_COMPONENT = Symbol('verso.RootComponent');

type WhenResult = unknown;

type RootAPI = {
  when?: Promise<WhenResult>;
};

export type RootProps = RenderableHTMLAttributes & RootAPI & {
  children: ReactNode; // required
};

export type DeriveRootProps<P> = (props: P) => Omit<RootProps, 'children'>;

type RootComponentMixin<P> = {
  [ROOT_COMPONENT]: {
    deriveRootProps: DeriveRootProps<P>;
  };
}

type RootComponent<P> = React.FC<P> & RootComponentMixin<P>;

export type AnyRootElement = React.ReactElement<any> & { type: RootComponent<any> };

export function makeRootComponent<P>(
  Component: React.FC<P>,
  deriveRootProps: DeriveRootProps<P>,
): FC<P> {
  const mixin: RootComponentMixin<P> = {
    [ROOT_COMPONENT]: {
      deriveRootProps,
    },
  };
  return Object.assign(Component, mixin);
}

function isRootElement(element: ReactElement): element is AnyRootElement {
  return isValidElement(element) && typeof element.type === 'function' && ROOT_COMPONENT in element.type;
}

export function ensureRootElement(element: ReactElement): AnyRootElement {
  return isRootElement(element) ? element : <Root>{element}</Root>;
}

const RootPassthrough: React.FC<RootProps> = ({ children }) => children;
RootPassthrough.displayName = 'Root';

// the trivial Root: directly renders its children; passes through all its non-children props
export const Root = makeRootComponent<RootProps>(RootPassthrough, (p) => {
  const { children: _children, ...rest } = p;
  return rest;
});

const NO_ROOT = Symbol('verso.NoRoot');
const RootContext = createContext<WhenResult>(NO_ROOT);

export type ScheduledRootRender = {
  promise: Promise<ReactElement>;
  attrs: RenderableHTMLAttributes;
};

export function scheduleRootRender(element: AnyRootElement): ScheduledRootRender {
  const { deriveRootProps } = element.type[ROOT_COMPONENT];
  const { when, ...attrs } = deriveRootProps(element.props);
  const whenPromise = (when ?? Promise.resolve())
    .catch((err) => {
      console.error("[verso] rejection from Root 'when' promise; using null data", err);
      return null;
    });
  return {
    promise: whenPromise.then((data) => (
      <StrictMode>
        <RootContext.Provider value={data}>
          {element}
        </RootContext.Provider>
      </StrictMode>
    )),
    attrs,
  };
}

export function useRootData<T>(): T {
  const value = useContext(RootContext);
  if (value === NO_ROOT) {
    throw new Error('[verso] useRootData() called outside a Root!');
  }
  return value as T;
}
