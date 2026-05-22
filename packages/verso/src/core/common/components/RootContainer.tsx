import React from 'react';
import { renderToString } from 'react-dom/server';
import { PAGE_ELEMENT_TOKEN_IDX_ATTR } from '../constants';

type RenderableHTMLAttributes = &
  Pick<
    React.HTMLAttributes<HTMLDivElement>,
    'id' | 'className' | 'style' | 'role' | 'hidden' | 'title' | 'lang' | 'dir' | 'tabIndex'
  > &
  React.AriaAttributes & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export type RootContainerProps = RenderableHTMLAttributes & {
  children?: React.ReactNode;
}

export function RootContainer(_: RootContainerProps): React.ReactNode {
  throw new Error('RootContainers cannot go inside non-RootContainers');
}

export type RootContainerElementType = React.ReactElement<RootContainerProps>;

const DIV_CLOSE = '</div>';

export function renderContainerOpen(element: RootContainerElementType, index: number): string {
  const { children, ...attrs } = element.props;
  const html = renderToString(<div {...{[PAGE_ELEMENT_TOKEN_IDX_ATTR]: String(index)}} {...attrs} />);
  return html.slice(0, -(DIV_CLOSE.length)) + '\n';
}

export function renderContainerClose(): string {
  return `${DIV_CLOSE}\n`;
}

// for client transitions
export function setContainerAttrs(el: HTMLElement, props: RootContainerProps, index: number) {
  el.setAttribute(PAGE_ELEMENT_TOKEN_IDX_ATTR, String(index));
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key.startsWith('on') || value == null) {
      // TODO: more props to skip? ideally we should match exactly what renderToString does
      continue;
    }
    if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'tabIndex') {
      el.tabIndex = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

