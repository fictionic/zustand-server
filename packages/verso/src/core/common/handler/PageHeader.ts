import {PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_HEADER_SCRIPT_ELEMENT_ATTR, PAGE_HEADER_STYLE_ELEMENT_ATTR} from "../constants";

export type Attrs = Record<string, string>;

/**
 * Defines a stylesheet, either via <link rel="stylesheet"> or via an inline <style>.
 */
export type Stylesheet = (
  | { href: string; }
  | { text: string; media?: string; }
) & { dataAttr?: { name: string; value?: string } };

export function getStyleAttrs(stylesheet: Stylesheet): Attrs {
  const attrs: Record<string, string> = {
    [PAGE_HEADER_STYLE_ELEMENT_ATTR]: '',
  };
  if ('href' in stylesheet) {
    attrs.href = stylesheet.href;
    attrs.rel = 'stylesheet';
  } else {
    if (stylesheet.media) attrs.media = stylesheet.media;
  }
  if (stylesheet.dataAttr) {
    attrs[stylesheet.dataAttr.name] = stylesheet.dataAttr.value ?? '';
  }
  return attrs;
}

export function makeLinkStylesheet(href: string): Stylesheet {
  return { href };
}

export type Script = &
  { type?: string; } &
  ({
    src: string;
    async?: boolean;
    defer?: boolean;
  } | {
    text: string
  });

export function getScriptAttrs(script: Script): Attrs {
  const attrs: Attrs = {
    [PAGE_HEADER_SCRIPT_ELEMENT_ATTR]: '',
  };
  if ('type' in script && script.type) attrs.type = script.type;
  if ('src' in script) attrs.src = script.src;
  if ('async' in script && script.async) attrs.async = '';
  if ('defer' in script && script.defer) attrs.defer = '';
  return attrs;
}

export type LinkTag = {
  rel: string;
  href: string;
  as?: string;
  crossorigin?: string;
  type?: string;
};

export function getLinkTagAttrs(link: LinkTag): Attrs {
  return {
    [PAGE_HEADER_LINK_ELEMENT_ATTR]: '',
    ...link,
  };
}

export type MetaTag = &
  (
   { name: string; } |
   { property: string; } |
   { httpEquiv: string; }
  ) & {
    content: string;
    /**
     * Wraps the <meta> in a <noscript>
     */
    noscript?: boolean;
  };
// excluding 'charset' because we hardcode it in writeHeader

export function getMetaTagAttrs(meta: MetaTag): Attrs {
  const attrs: Attrs = {};
  if ('name' in meta)      attrs.name = meta.name;
  if ('property' in meta)  attrs.property = meta.property;
  if ('httpEquiv' in meta) attrs['http-equiv'] = meta.httpEquiv;
  if ('content' in meta)   attrs.content = meta.content;
  return attrs;
}

export function setNodeAttrs(node: HTMLElement, attrs: Attrs) {
  Object.keys(attrs).forEach((attr) => {
    node.setAttribute(attr, (attrs as any)[attr]);
  });
}
