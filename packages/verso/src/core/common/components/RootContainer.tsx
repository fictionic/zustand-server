import {type ReactNode} from 'react';
import {type RenderableHTMLAttributes} from './attrs';

export type RootContainerProps = RenderableHTMLAttributes & {
  children?: ReactNode;
}

export function RootContainer(_: RootContainerProps): ReactNode {
  throw new Error('RootContainers cannot go inside non-RootContainers');
}

export type AnyRootContainer = React.ReactElement<RootContainerProps>;
