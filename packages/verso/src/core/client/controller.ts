import {getLinkTagAttrs, getMetaTagAttrs, setNodeAttrs, type MetaTag} from "../common/handler/Page";
import {hydrateRoot} from "react-dom/client";
import {TOKEN, tokenizeElements} from "../common/tokenizeElements";
import {scheduleRootRender} from "../common/components/Root";
import {PAGE_ELEMENT_TOKEN_IDX_ATTR, PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../common/constants";
import {FETCH_CACHE_KEY, FN_ABORT_HYDRATION, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_SIGNAL_END_OF_DATA, FN_SIGNAL_ROOTS_COMPLETE, REQUEST_DATA_KEY, VersoPipe} from "../common/VersoPipe";
import {Fetch} from "../common/fetch/Fetch";
import {StyleTransitioner} from "./transitioners/styles";
import { ScriptTransitioner } from "./transitioners/scripts";
import {HistoryManager, type NavigationDirection, type OnPopState} from "./history";
import {ClientNavigationManager, type StartNavigation, type CommitNavigation} from "./navigation";
import {BodyElementTransitioner} from "./transitioners/body";
import {ReactRootManager} from "./roots";
import {flushSync} from "react-dom";
import type {Resolver} from "../common/resolver";
import {stripUrlHash} from "./url";
import type {ClientSettings} from "../../build/config";
import {unmarshallBody} from "../common/util/body";
import type {ClientManifest} from "@verso-js/contract";

let self: ClientController | null = null;
export function getClientController(): ClientController {
  if (!self) {
    throw new Error('ClientController not initialized!');
  }
  return self;
}

export type NavigateOptions = {
  reuseDom: boolean;
}

export class ClientController {
  private styleTransitioner: StyleTransitioner;
  private scriptTransitioner: ScriptTransitioner;
  private historyManager: HistoryManager;
  private reactRootManager: ReactRootManager;
  private navigationManager: ClientNavigationManager;

  constructor(resolver: Resolver, manifest: ClientManifest | null, private settings: ClientSettings) {
    this.styleTransitioner = new StyleTransitioner(manifest);
    this.scriptTransitioner = new ScriptTransitioner();
    const onPopToVersoState: OnPopState = async (url, options) => {
      try {
        await this.navigate(url, 'POP', options);
      } catch (err) {
        console.error("[verso] navigation failed", err);
      }
    };
    this.historyManager = new HistoryManager(onPopToVersoState);
    this.reactRootManager = new ReactRootManager();
    this.navigationManager = new ClientNavigationManager(resolver);
    self = this;
  }

  async hydrate() {
    // set up the listener right away, in case we need to interrupt hydration
    this.historyManager.installListener();
    // mark the history frame as ours. we re-stamp on navigate, but we need this
    // upfront in case there's a userland pushstate before a verso navigation.
    // note that it's safe to reuse the dom here because the only way to pop
    // to this state is by doing a non-verso pushstate, then a popstate,
    // which means we're on the same page as before.
    this.historyManager.stampHistoryFrame({ reuseDom: true });

    // get the transitioners up to speed on the server render
    this.styleTransitioner.readServerStyles();
    this.scriptTransitioner.readServerScripts();

    const readablePipe = VersoPipe.reader();

    // first check the details of the server request
    const serverRequestData = readablePipe.readValue(REQUEST_DATA_KEY) ?? {};
    let { method, url } = serverRequestData;
    if (!method) {
      console.error("[verso] hydration error: missing http method! assuming GET");
      method = 'GET';
    }
    const currentUrl = stripUrlHash(window.location.href); // no hash server-side
    if (!url) {
      console.error("[verso] hydration error: missing request url! assuming window.location.href");
      url = currentUrl;
    }

    if (url !== currentUrl) {
      const options = this.historyManager.getNavigateOptions();
      if (!options) {
        console.error('[verso] history frame was not verso-stamped! how did we get here? bailing out.');
        return;
      }
      // the user navigated their browser to a different verso page before this request bootstrapped.
      // let's follow them.
      return await this.navigate(currentUrl, 'POP', options);
    }

    const rootDomNodeDfds: Array<PromiseWithResolvers<Element>> = [];
    const rootHydrationDfds: Array<PromiseWithResolvers<void>> = [];

    function abortHydration(startFromRootIndex: number = 0) {
      for (let i = startFromRootIndex; i < rootDomNodeDfds.length; i++) {
        // note that these are sparse arrays
        rootDomNodeDfds[i]?.reject();
        rootHydrationDfds[i]?.resolve();
      }
    }

    const start: StartNavigation = (signal) => {
      const fetchCache = readablePipe.readValue(FETCH_CACHE_KEY);
      if (!fetchCache) {
        console.error("[verso] hydration error: missing fetch cache! fetch() calls will be re-executed");
      }
      Fetch.clientInit(fetchCache ?? {});

      signal.addEventListener('abort', () => abortHydration());

      const { body } = serverRequestData;

      return new Request(url, {
        method: method,
        body: unmarshallBody(body),
        signal, // cancel any fetch() requests that miss the cache
      });
    };

    const commit: CommitNavigation = async ({ page, url }) => {
      if (url !== currentUrl) {
        throw new Error("resolved URL did not match current URL! this indicates non-isomorphic behavior in getRouteDirective (the client returned a redirect, and the server did not). aborting hydration.");
      }

      const tokens = tokenizeElements(page.getElements());

      tokens.forEach((token, i) => {
        if (token.type === TOKEN.ROOT) {
          const hydrationDfd = Promise.withResolvers<void>();
          rootHydrationDfds[i] = hydrationDfd;
          rootDomNodeDfds[i] = Promise.withResolvers();
          // start rendering below-the-fold roots before their dom nodes have streamed in
          const { promise: renderPromise, attrs: _attrs } = scheduleRootRender(token.element);
          rootDomNodeDfds[i].promise.then(async (node) => {
            try {
              const reactElement = await renderPromise;
              const reactRoot = flushSync(() => hydrateRoot(node, reactElement));
              this.reactRootManager.registerReactRoot(reactRoot, i);
              hydrationDfd.resolve();
            } catch (e) {
              console.error(`[verso] error hydrating root ${i}`, e);
              hydrationDfd.reject();
            }
          }, (_e) => {} /* swallow rejections from abort to prevent unhandled rejection */);
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
      // TODO: or maybe it wouldn't be too hard to support?
      const receivedAllRootDomNodesDfd = Promise.withResolvers<void>();

      let nextRootIndex = 0;
      function hydrateRootsUpTo(index: number) {
        for (let i = nextRootIndex; i <= index; i++) {
          const dfd = rootDomNodeDfds[i];
          if (!dfd) {
            // not a root
            continue;
          }
          const node = document.querySelector(`[${PAGE_ROOT_ELEMENT_ATTR}][${PAGE_ELEMENT_TOKEN_IDX_ATTR}="${i}"]`);
          if (!node) {
            console.warn(`[verso] error hydrating root ${i}: DOM node not found`);
            continue;
          }
          dfd.resolve(node);
        }
        nextRootIndex = index + 1;
      };

      // sent when all the body html, including all root html and late arrival
      // data, has streamed down.
      const receivedAllDataDfd = Promise.withResolvers<void>();

      readablePipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO, hydrateRootsUpTo);
      readablePipe.onCallFn(FN_SIGNAL_ROOTS_COMPLETE, receivedAllRootDomNodesDfd.resolve);
      readablePipe.onCallFn(FN_RECEIVE_LATE_DATA_ARRIVAL, Fetch.getCache().client().receiveLateArrivalData);
      readablePipe.onCallFn(FN_ABORT_HYDRATION, () => abortHydration(nextRootIndex));
      readablePipe.onCallFn(FN_SIGNAL_END_OF_DATA, () => receivedAllDataDfd.resolve());

      receivedAllDataDfd.promise.then(() => {
        readablePipe.destroy(); // TODO: also remove script tags from dom?
      });

      await Promise.all([
        allRootsSettled,
        receivedAllRootDomNodesDfd.promise,
      ]);
    };

    await this.navigationManager.requestNavigation(start, commit);
  }

  async navigate(requestedUrl: string, direction: NavigationDirection, _options?: Partial<NavigateOptions>): Promise<void> {
    const options = this.fillNavigateOptions(_options);
    if (direction === 'PUSH') {
      // stamp the outgoing frame with the history options used to navigate away, so we can reuse them in case we popstate back.
      // TODO: what if the popstate skips links in the history chain? should we also track the url in the frame,
      // and only use rely on the frame's reuseDom on navigations from that url?
      this.historyManager.stampHistoryFrame(options);
    }

    const start: StartNavigation = (signal) => {
      Fetch.clientInit(); // just initiate an empty cache, since Fetch assumes it'll exist
      return new Request(requestedUrl, {
        method: 'GET', // client navigations are always GET
        signal,
      });
    };

    const commit: CommitNavigation = async ({ page, routeName, url: resolvedUrl }) => {
      if (direction === 'PUSH') {
        this.historyManager.pushFrame(resolvedUrl);
      } else if (direction === 'POP') {
        if (resolvedUrl !== stripUrlHash(window.location.href)) {
          throw new Error("[verso] resolved URL did not match current URL! how did this happen? aborting navigation.");
        }
      }

      // =header=
      document.title = await page.getTitle() ?? ''; // no way to unset title; technically sort of non-isomorphic

      // update links. can just blindly throw away old ones and add new ones
      document.querySelectorAll(`[${PAGE_HEADER_LINK_ELEMENT_ATTR}]`).forEach(node => {
        node.parentNode?.removeChild(node);
      });
      const linkTags = await page.getLinkTags();
      linkTags.forEach((link) => {
        const node = document.createElement('link');
        setNodeAttrs(node, getLinkTagAttrs(link));
        document.head.appendChild(node);
      });

      // update meta tags. throw away old ones and add new ones
      document.head.querySelectorAll('meta').forEach(node => node.parentNode?.removeChild(node));
      const metaTags = await page.getMetaTags();
      metaTags.forEach((tag) => renderMetaTag(tag));

      // update styles. have to take care to avoid FOUC
      const stylesheets = await page.getStylesheets();
      const cleanupPreviousStyles = await this.styleTransitioner.transitionStyles(routeName, stylesheets);

      // update scripts. track each one and only add new ones
      const scripts = await page.getScripts();
      this.scriptTransitioner.transitionScripts(scripts);

      // =body=

      // classname
      const newBodyClasses = await page.getBodyClasses();
      document.body.className = newBodyClasses.join(' ');

      // elements
      const transitioner = new BodyElementTransitioner(this.reactRootManager, options);
      await transitioner.transitionElements(page.getElements());

      // finally clean up any unneeded stylesheets from the last route
      cleanupPreviousStyles();
    }

    await this.navigationManager.requestNavigation(start, commit);
  }

  subscribeToNavigation(listener: () => void) {
    return this.navigationManager.subscribe(listener);
  }

  getNavigationState() {
    return this.navigationManager.getState();
  }

  private fillNavigateOptions(options?: Partial<NavigateOptions>): NavigateOptions {
    return {
      ...this.settings,
      ...(options ?? {}),
    };
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
