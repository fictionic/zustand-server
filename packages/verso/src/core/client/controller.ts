import {getLinkTagAttrs, getMetaTagAttrs, setNodeAttrs, type MetaTag} from "../common/handler/Page";
import {createRoot, hydrateRoot, type Root as ReactRoot} from "react-dom/client";
import {TOKEN, tokenizeElements} from "../common/tokenizeElements";
import {scheduleRootRender, setRootAttrs} from "../common/components/Root";
import {PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../common/constants";
import {FETCH_CACHE_KEY, FN_ABORT_HYDRATION, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_SIGNAL_ROOTS_COMPLETE, REQUEST_METHOD_KEY, VersoPipe} from "../common/VersoPipe";
import {Fetch} from "../common/fetch/Fetch";
import {startClientRequest} from "../common/RequestLocalStorage";
import {setContainerAttrs} from "../common/components/RootContainer";
import {StyleTransitioner} from "./styles";
import { ScriptTransitioner } from "./scripts";
import type {BundleManifest} from "../../build/bundle";
import {HistoryManager, type NavigationDirection, type OnPopState} from "./history";
import type {ReactElement} from "react";
import {flushSync} from "react-dom";
import type {Navigator} from "../common/navigator";
import {getAbortSignal, initAbortController} from "../common/abort";
import {ClientNavigationManager, type StartNavigation, type CommitNavigation} from "./navigation";
import {PageElementProcessor} from "../common/PageElementProcessor";

let self: ClientController | null = null;
export function getClientController(): ClientController {
  if (!self) {
    throw new Error('ClientController not initialized!');
  }
  return self;
}

export interface NavigateOptions {
  // TODO: reuseDom
}

export class ClientController {
  private reactRoots: Set<ReactRoot>; // so we can unmount them on navigation
  private styleTransitioner: StyleTransitioner;
  private scriptTransitioner: ScriptTransitioner;
  private historyManager: HistoryManager;
  private navigationManager: ClientNavigationManager;

  constructor(navigator: Navigator, manifest: BundleManifest | null) {
    this.reactRoots = new Set();
    this.styleTransitioner = new StyleTransitioner(manifest);
    this.scriptTransitioner = new ScriptTransitioner();
    const onPopState: OnPopState = (url, options) => this.navigate(url, 'POP', options);
    this.historyManager = new HistoryManager(onPopState);
    this.navigationManager = new ClientNavigationManager(navigator);
    self = this;
  }

  async hydrate() {
    const readablePipe = VersoPipe.reader();

    const rootDomNodeDfds: Array<PromiseWithResolvers<Element>> = [];
    const rootHydrationDfds: Array<PromiseWithResolvers<void>> = [];

    function abortHydration(startFromRootIndex: number = 0) {
      for (let i = startFromRootIndex; i < rootDomNodeDfds.length; i++) {
        // note that these are sparse arrays
        rootDomNodeDfds[i]?.reject();
        rootHydrationDfds[i]?.resolve();
      }
    }

    const start: StartNavigation = () => {
      startClientRequest();

      const abortController = initAbortController();
      this.styleTransitioner.readServerStyles();
      this.scriptTransitioner.readServerScripts();

      const fetchCache = readablePipe.readValue(FETCH_CACHE_KEY);
      if (!fetchCache) {
        console.error("[verso] hydration error: missing fetch cache! fetch() calls will be re-executed");
      }
      Fetch.clientInit(fetchCache ?? {});

      const method = readablePipe.readValue(REQUEST_METHOD_KEY);
      if (!method) {
        console.error("[verso] hydration error: missing http method! assuming GET");
      }

      const req = new Request(window.location.href, {
        method: method ?? 'GET',
        signal: abortController.signal, // cancel any fetch() requests that miss the cache
      });

      return {
        req,
        interrupt: () => {
          abortController.abort();
          abortHydration();
        },
      };
    };

    const commit: CommitNavigation = async ({ page }) => {
      this.historyManager.stampHistoryFrame();
      // TODO: should we repeat ^this defensively after all roots have hydrated
      // in case userland code has clobbered it? or treat that as misuse?

      const tokens = tokenizeElements(page.getElements());

      tokens.forEach((token, i) => {
        if (token.type === TOKEN.ROOT) {
          const hydrationDfd = Promise.withResolvers<void>();
          rootHydrationDfds[i] = hydrationDfd;
          rootDomNodeDfds[i] = Promise.withResolvers();
          // start rendering below-the-fold roots before their dom nodes have streamed in
          const renderPromise = scheduleRootRender(token.element);
          rootDomNodeDfds[i].promise.then(async (node) => {
            try {
              const reactElement = await renderPromise;
              const reactRoot = hydrateRoot(node, reactElement);
              this.reactRoots.add(reactRoot);
              hydrationDfd.resolve();
            } catch (e) {
              console.error(`[verso] error hydrating root ${i}`, e);
              hydrationDfd.reject();
            }
          });
        }
      });

      const allRootsSettled = Promise.allSettled(
        Object.values(rootHydrationDfds)
          .map(dfd => dfd.promise)
      );

      // this is tracked separately from allRootsHydrated because
      // root hydration dfds will reject early if page hydration is
      // interrupted by a new navigation.
      // we need to wait for all the root DOM nodes to stream in
      // before proceeding with a client transition, otherwise
      // things get real messy.
      const receivedAllRootDomNodesDfd = Promise.withResolvers<void>();

      const done = Promise.all([
        allRootsSettled,
        receivedAllRootDomNodesDfd.promise,
      ]).then(() => {
        this.historyManager.installListener();
        readablePipe.destroy();
      });

      let nextRootIndex = 0;
      function hydrateRootsUpTo(index: number) {
        for (let i = nextRootIndex; i <= index; i++) {
          const dfd = rootDomNodeDfds[i];
          if (!dfd) {
            // not a root
            continue;
          }
          const node = document.querySelector(`[${PAGE_ROOT_ELEMENT_ATTR}][${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}"]`);
          if (!node) {
            console.warn(`[verso] error hydrating root ${i}: DOM node not found`);
            continue;
          }
          dfd.resolve(node);
        }
        nextRootIndex = index + 1;
      };

      readablePipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO, hydrateRootsUpTo);
      readablePipe.onCallFn(FN_SIGNAL_ROOTS_COMPLETE, receivedAllRootDomNodesDfd.resolve);
      readablePipe.onCallFn(FN_RECEIVE_LATE_DATA_ARRIVAL, Fetch.getCache().client().receiveLateArrivalData);
      readablePipe.onCallFn(FN_ABORT_HYDRATION, () => abortHydration(nextRootIndex));

      await done;
    };

    await this.navigationManager.requestNavigation(start, commit);
  }

  async navigate(url: string, direction: NavigationDirection, options: NavigateOptions = {}): Promise<void> {
    const start: StartNavigation = () => {
      startClientRequest(); // new page chain, new RLS context
      Fetch.clientInit(); // just initiate an empty cache, since Fetch assumes it'll exist
      const abortController = initAbortController();
      return {
        req: new Request(url, {
          method: 'GET', // client navigations are always GET
          signal: abortController.signal,
        }),
        interrupt: () => {
          abortController.abort();
          // TODO anything else to do here?
        },
      };
    };

    const commit: CommitNavigation = async ({ page, routeName }) => {
      if (direction === 'PUSH') {
        this.historyManager.pushFrame(url, options);
      }

      // =header=
      document.title = page.getTitle() ?? ''; // no way to unset title; technically sort of non-isomorphic

      // update base tag
      const base = page.getBase();
      let baseNode = document.head.querySelector('base');
      if (base === null) {
        baseNode?.parentNode?.removeChild(baseNode);
      } else {
        if (!baseNode) {
          baseNode = document.createElement('base');
          document.head.prepend(baseNode);
        }
        if (base.href) baseNode.href = base.href;
        if (base.target) baseNode.target = base.target;
      }

      // update links. can just blindly throw away old ones and add new ones
      document.querySelectorAll(`[${PAGE_HEADER_LINK_ELEMENT_ATTR}]`).forEach(node => {
        node.parentNode?.removeChild(node);
      });
      const linkTags = [
        ...await page.getSystemLinkTags(),
        ...page.getLinkTags(),
      ];
      linkTags.forEach((link) => {
        const node = document.createElement('link');
        setNodeAttrs(node, getLinkTagAttrs(link));
        document.head.appendChild(node);
      });

      // update meta tags. throw away old ones and add new ones
      document.head.querySelectorAll('meta').forEach(node => node.parentNode?.removeChild(node));
      page.getMetaTags().forEach((tag) => renderMetaTag(tag));

      // update styles. have to take care to avoid FOUC
      const stylesheets = [
        ...await page.getSystemStylesheets(),
        ...page.getStylesheets(),
      ];
      const cleanupPreviousStyles = await this.styleTransitioner.transitionStyles(routeName, stylesheets);

      // update scripts. track each one and only add new ones
      const scripts = [
        ...await page.getSystemScripts(),
        ...page.getScripts()
      ];
      this.scriptTransitioner.transitionScripts(scripts);

      // =body=

      // classname
      const newBodyClasses = await page.getBodyClasses();
      document.body.className = newBodyClasses.join(' ');

      // elements
      // first blow away the old roots -- TODO: reuseDom
      this.reactRoots.forEach((root) => root.unmount());
      this.reactRoots.clear();
      document.body.innerHTML = ''; // TODO put all roots in a supercontainer in case I want to add getBodyStartContent

      // then render and mount the new ones. use the same algorithm as the server render.
      let currentContainer: Node = document.body;
      type RenderedElement = |
        {
        kind: 'open';
        divElement: HTMLElement;
      } | {
        kind: 'close';
      } | {
        kind: 'root';
        rendered: { rootElement: ReactElement, index: number };
      };
      const processor = new PageElementProcessor<RenderedElement>({
        renderContainerOpen: (element, index) => {
          const divElement = document.createElement('div');
          setContainerAttrs(divElement, element.props, index);
          return {
            kind: 'open' as const,
            divElement,
          };
        },
        renderContainerClose: () => {
          return { kind: 'close' };
        },
        renderRootElement: (rootElement, index) => {
          return { kind: 'root', rendered: { rootElement, index } };
        },
        consumeRenderedElements: (elements) => {
          elements.forEach((element) => {
            if (getAbortSignal().aborted) return; // another navigation is about to run
            switch (element.kind) {
              case 'open': {
                currentContainer.appendChild(element.divElement);
                currentContainer = element.divElement;
                break;
              }
              case 'close': {
                currentContainer = currentContainer.parentNode!;
                break;
              }
              case 'root': {
                const { rootElement, index } = element.rendered;
                const newNode = document.createElement('div');
                setRootAttrs(newNode, index)
                currentContainer.appendChild(newNode);
                const reactRoot = createRoot(newNode);
                this.reactRoots.add(reactRoot);
                try {
                  // without flushSync, the concurrent scheduler could mount roots out of order (I think)
                  flushSync(() => reactRoot.render(rootElement));
                } catch (err) {
                  console.error("[verso] error rendering root", err);
                }
                break;
              }
              default:
                element satisfies never;
            }
          });
        },
      });

      await processor.process(page.getElements());

      // finally clean up any unneeded stylesheets from the last route
      cleanupPreviousStyles();
    }

    await this.navigationManager.requestNavigation(start, commit);
  }
}

function renderMetaTag(tag: MetaTag) {
  const meta = document.createElement('meta');
  for (const [k, v] of Object.entries(getMetaTagAttrs(tag))) {
    meta.setAttribute(k, v);
  }
  if (tag.noscript) {
    const noscript = document.createElement('noscript');
    noscript.appendChild(meta);
    document.head.appendChild(noscript);
  } else {
    document.head.appendChild(meta);
  }
}
