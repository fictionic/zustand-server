import {getAbortPromise, initAbort} from "../common/abort";
import {MAX_RECURSIVE_DEPTH} from "../common/constants";
import type {StandardizedPage} from "../common/handler/Page";
import {startClientRLS} from "../common/RequestLocalStorage";
import type {Resolver} from "../common/resolver";
import {isInterruption, TaskRunner} from "./task";

export type StartNavigation = (signal: AbortSignal) => Request;
export type CommitNavigation = (result: PageResolution) => Promise<void>;
export type PageResolution = {
  page: StandardizedPage;
  routeName: string;
  url: string; // for clientside 3XX redirects
};

export type NavigationState = |
  {
    status: 'pending';
    requestedUrl: string;
    // TODO direction: NavigationDirection;
  } | {
    status: 'idle',
    routeName: string;
    location: string;
  };

export class ClientNavigationManager {
  private waitForPendingDfd: PromiseWithResolvers<void>;
  private waitForIdleDfd: PromiseWithResolvers<void>;
  private taskRunner: TaskRunner;
  private listeners: Set<() => void>;
  private state: NavigationState;
  private hydrating: boolean;
  private resolutionDepth: number = 1; // doesn't need RLS because only one navigation runs at a time

  constructor(private resolver: Resolver) {
    this.taskRunner = new TaskRunner({
      onActive: () => {
        this.markNavigationStart();
      },
      onIdle: () => {
        this.markNavigationEnd();
      },
    });
    this.listeners = new Set();
    this.state = {
      status: 'pending',
      requestedUrl: window.location.href,
      // ^this might not be the right url but no one should be reading our
      // state before we start hydration anyway
    };
    this.hydrating = true;
    this.waitForPendingDfd = Promise.withResolvers();
    this.waitForPendingDfd.resolve();
    this.waitForIdleDfd = Promise.withResolvers();
    window.__versoNavigation = {
      // for playwright tests, etc
      waitForIdle: async () => {
        await this.waitForIdleDfd.promise;
      },
      waitForNextIdle: async () => {
        await this.waitForPendingDfd.promise;
        await this.waitForIdleDfd.promise;
      },
    };
  }

  async requestNavigation(start: StartNavigation, commit: CommitNavigation) {
    const task = () => {
      startClientRLS();
      const abortController = new AbortController();
      const { signal } = abortController;
      initAbort(signal);
      const req = start(signal);
      this.setPending(req.url);
      const promise = Promise.race([
        this.getPageResolution(req),
        getAbortPromise(),
      ])
        .then(async (result) => {
          await commit(result);
          if (!signal.aborted) {
            this.setIdle(result);
          }
        });
      return {
        promise,
        interrupt: () => {
          abortController.abort(new Error('interrupted by subsequent navigation'));
        },
      };
    }
    try {
      await this.taskRunner.runTask(task);
    } catch (e) {
      if (isInterruption(e)) {
        // swallow
        return;
      }
      throw e;
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): NavigationState {
    return this.state;
  }

  private setPending(requestedUrl: string) {
    this.state = {
      status: 'pending',
      requestedUrl,
    };
    this.emit();
  }

  private setIdle({ routeName, url }: PageResolution) {
    this.state = {
      status: 'idle',
      routeName,
      location: url,
    };
    this.emit();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Wrapper around Resolver.resolveRoute() tailored to ClientController
   */
  private async getPageResolution(req: Request): Promise<PageResolution> {
    try {
      if (this.resolutionDepth > MAX_RECURSIVE_DEPTH) {
        throw new Error('max resolution depth exceeded!');
      }
      this.resolutionDepth++;
      const resolution = await this.resolver.resolveRoute(req);
      if (resolution.kind !== 'response') throw new Error('resolution failed; aborting');
      const { routeName, redirectLocation, handler } = resolution;
      if (redirectLocation) {
        const url = new URL(redirectLocation, window.location.origin);
        if (url.origin === window.location.origin) {
          const newReq = new Request(redirectLocation, {
            // if we're in hydrate, the controller will bail out
            // as soon as we come back with a different url.
            // so we can assume we're in navigate. in this case,
            // we know the request is a GET and that there's no body.
            signal: req.signal,
          });
          // I'm not sure why a page would attempt to navigate to a url
          // that returns a 3XX redirect server-side, but we might as well
          // do something reasonable here, so we recurse
          return Promise.race([
            this.getPageResolution(newReq),
            getAbortPromise(),
          ]);
        } else {
          window.location.href = redirectLocation;
          return Promise.reject(new Error('cross-origin redirect'));
        }
      }
      if (!handler) {
        throw new Error('resolver returned success but with no page handler. did you forget to set hasBody?');
      }
      if (handler.type !== 'page') {
        throw new Error(`client-side navigation only supports page handlers, got ${handler.type}`);
      }
      return {
        page: handler,
        routeName,
        url: new URL(req.url, window.location.origin).href,
      };
    } finally {
      this.resolutionDepth--;
    }
  }

  private markNavigationStart() {
    this.waitForPendingDfd.resolve();
    if (this.hydrating) {
      // we already primed the idle dfd in the constructor
      return;
    }
    this.waitForIdleDfd = Promise.withResolvers();
  }

  private markNavigationEnd() {
    this.waitForIdleDfd.resolve();
    this.waitForPendingDfd = Promise.withResolvers();
    if (this.hydrating) {
      this.hydrating = false;
    }
  }

}
