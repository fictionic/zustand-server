import {Children, isValidElement} from "react";
import {RootContainer, type AnyRootContainer} from "./components/RootContainer";
import {ensureRootElement, type AnyRootElement} from "./components/Root";
import {TheFold} from "./components/TheFold";

export const TOKEN = {
  ROOT: 'ROOT',
  THE_FOLD: 'THE_FOLD',
  CONTAINER_OPEN: 'CONTAINER_OPEN',
  CONTAINER_CLOSE: 'CONTAINER_CLOSE',
} as const;

type RootToken = {
  type: typeof TOKEN.ROOT;
  element: AnyRootElement;
};
type TheFoldToken = {
  type: typeof TOKEN.THE_FOLD;
};
type ContainerOpenToken = {
  type: typeof TOKEN.CONTAINER_OPEN;
  element: AnyRootContainer;
};
type ContainerCloseToken = {
  type: typeof TOKEN.CONTAINER_CLOSE;
};

export type PageElementToken = RootToken | TheFoldToken | ContainerOpenToken | ContainerCloseToken;

export function tokenizeElements(elements: React.ReactElement[]): PageElementToken[] {
  return elements
    .flatMap((element): PageElementToken[] => {
      if (isRootContainer(element)) {
        return tokenizeContainer(element);
      }
      if (isTheFold(element)) {
        return [{ type: TOKEN.THE_FOLD }];
      }
      return [{
        type: TOKEN.ROOT,
        element: ensureRootElement(element),
      }];
    });
}

function isTheFold(element: React.ReactElement): boolean {
  return isValidElement(element) && element.type === TheFold;
}

function isRootContainer(element: React.ReactElement): element is AnyRootContainer {
  return isValidElement(element) && element.type === RootContainer;
};

export function tokenizeContainer(element: AnyRootContainer): PageElementToken[] {
  const open: ContainerOpenToken = { type: TOKEN.CONTAINER_OPEN, element };
  const childArray = Children.toArray(element.props.children) as React.ReactElement[];
  const tokenizedChildren: PageElementToken[] = tokenizeElements(childArray);
  const close: ContainerCloseToken = { type: TOKEN.CONTAINER_CLOSE };
  return [open, ...tokenizedChildren, close];
}

