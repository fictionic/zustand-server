export type RenderableHTMLAttributes = &
  Pick<
    React.HTMLAttributes<HTMLDivElement>,
    'id' | 'className' | 'style' | 'role' | 'hidden' | 'title' | 'lang' | 'dir' | 'tabIndex'
  > &
  React.AriaAttributes & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};
