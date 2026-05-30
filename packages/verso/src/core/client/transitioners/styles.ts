import {DEV_ROUTE_CSS_PATH, DEV_VITE_STYLE_ID_ATTR, PAGE_HEADER_STYLE_ELEMENT_ATTR} from "../../common/constants";
import {getStyleAttrs, setNodeAttrs, type Stylesheet} from "../../common/handler/Page";
import {normalizeUrlOrigin} from "../url";
import type {BundleManifest} from "../../../build/bundle";

type StyleElement = HTMLLinkElement | HTMLStyleElement;

export class StyleTransitioner {
  private manifest: BundleManifest | null;
  private loaded: Map<string, StyleElement>;


  constructor(manifest: BundleManifest | null) {
    this.manifest = manifest;
    this.loaded = new Map<string, StyleElement>();
  }

  readServerStyles() {
    const serverStyles = document.querySelectorAll<StyleElement>(
      `link[${PAGE_HEADER_STYLE_ELEMENT_ATTR}],style[${PAGE_HEADER_STYLE_ELEMENT_ATTR}]`,
    );
    serverStyles.forEach((node) => {
      this.loaded.set(this.keyForNode(node), node);
    });
    // in dev, we have sent down links to the vite style assets with the proper data-vite-dev-id
    // attribute. vite is smart enough to recognize these--it won't load a duplicate inline style,
    // and it will hot-reload them as the files change.
  }

  async transitionStyles(routeName: string, pageStylesheets: Stylesheet[]): Promise<() => void> {
    const routeStylesheets = await this.getRouteStylesheets(routeName, this.manifest);
    const newStylesheets = [
      ...routeStylesheets,
      ...pageStylesheets,
    ];
    const nodePromises: Array<Promise<StyleElement>> = newStylesheets.map((stylesheet) => {
      const key = this.keyFor(stylesheet);
      if (this.loaded.has(key)) {
        return Promise.resolve(this.loaded.get(key)!);
      } else {
        if (globalThis.IS_DEV) {
          // vite will have automatically injected a new style. just use that.
          const viteId = key;
          const viteStyle = this.findViteStyle(viteId);
          if (!viteStyle) {
            console.error(`could not find vite style ${viteId}`);
            return Promise.reject();
          }
          this.loaded.set(viteId, viteStyle);
          return Promise.resolve(viteStyle);
        } else {
          const newNode = this.createStyleNode(stylesheet);
          const dfd = Promise.withResolvers<StyleElement>();
          if (newNode.tagName === 'LINK') {
            newNode.onload = () => {
              dfd.resolve(newNode);
            };
            newNode.onerror = (e) => {
              console.error("failed to load stylesheet", e);
              dfd.reject();
            }
          } else {
            dfd.resolve(newNode);
          }
          document.head.appendChild(newNode); // kick off the download. we'll reorder later
          this.loaded.set(key, newNode);
          return dfd.promise;
        }
      }
    });
    const results = await Promise.allSettled(nodePromises);
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const node = result.value;
        document.head.appendChild(node); // insert / move all nodes into correct ordering, for css specificity
        if (globalThis.IS_DEV) {
          if (node.disabled) {
            // reenable disabled vite styles from prior transitions
            node.disabled = false;
          }
        }
      }
    });
    const currentKeys = new Set(newStylesheets.map(s => this.keyFor(s)));
    return () => {
      // return a function that cleans up dangling styles from the previous route
      for (const [key, node] of this.loaded) {
        if (currentKeys.has(key)) continue;
        if (globalThis.IS_DEV) {
          node.disabled = true; // keep in DOM for vite's sheetsMap
        } else {
          node.remove();
          this.loaded.delete(key);
        }
      }
    };
  }

  findViteStyle(viteId: string): HTMLStyleElement | null {
    // vite IDs are absolute file paths, which can contain arbitrary characters.
    // instead of escaping them in the querySelector, just iterate in js
    for (const node of document.querySelectorAll<HTMLStyleElement>(`style[${DEV_VITE_STYLE_ID_ATTR}]`)) {
      if (node.getAttribute(DEV_VITE_STYLE_ID_ATTR) === viteId) return node;
    }
    return null;
  }

  keyFor(stylesheet: Stylesheet): string {
    if (globalThis.IS_DEV) {
      const { dataAttr } = stylesheet;
      if (dataAttr?.name === DEV_VITE_STYLE_ID_ATTR && dataAttr.value) {
        return dataAttr.value;
      }
    }
    if ('href' in stylesheet) {
      return normalizeUrlOrigin(stylesheet.href);
    }
    return stylesheet.text;
  }

  keyForNode(node: StyleElement): string {
    if (globalThis.IS_DEV) {
      const viteAttr = node.getAttribute(DEV_VITE_STYLE_ID_ATTR);
      if (viteAttr) {
        return viteAttr;
      }
    }
    const stylesheet: Stylesheet = {
      ...(node.tagName === 'LINK' ? {
        href: (node as HTMLLinkElement).href,
      } : {
        text: (node as HTMLStyleElement).innerHTML,
      }),
    };
    return this.keyFor(stylesheet);
  }

  createStyleNode(style: Stylesheet): StyleElement {
    if ('href' in style) {
      const node = document.createElement('link');
      setNodeAttrs(node, getStyleAttrs(style));
      return node;
    }
    const node = document.createElement('style');
    setNodeAttrs(node, getStyleAttrs(style));
    node.innerHTML = style.text;
    return node;
  }

  async getRouteStylesheets(routeName: string, manifest: BundleManifest | null): Promise<Stylesheet[]> {
    if (globalThis.IS_DEV) {
      try {
        const res = await fetch(`${DEV_ROUTE_CSS_PATH}?route=${encodeURIComponent(routeName)}`);
        if (!res.ok) throw new Error(`fetch error: ${res.statusText}`);
        const body = await res.json() as { stylesheets: Stylesheet[] };
        return body.stylesheets;
      } catch (e) {
        console.error('[verso] failed to fetch dev route stylesheets', e);
        return [];
      }
    } else {
      if (!manifest) {
        throw new Error("[verso] no bundle manifest");
      }
      const routeAssets = manifest[routeName];
      if (!routeAssets) {
        throw new Error(`[verso] no bundles for route ${routeName}`);
      }
      return routeAssets.stylesheets.map((href) => ({ href }));
    }
  }

};

